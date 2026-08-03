import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type {
  BlockerEncounteredParams,
  BlockerRecord,
  BlockerResolvedParams,
  DecisionParams,
  DecisionRecord,
  F2Result,
  F3Result,
  FalkorGraphClient,
  FileParams,
  MutationResult,
  StepParams,
  TaskParams,
} from "./types.js";

interface NodeRecord {
  readonly label: string;
  readonly id: string;
  props: Record<string, unknown>;
}

interface EdgeRecord {
  readonly type: string;
  readonly from: string; // `${label}:${id}`
  readonly to: string;
}

interface GraphStore {
  nodes: Record<string, NodeRecord>; // key: `${label}:${id}`
  edges: EdgeRecord[];
}

function emptyStore(): GraphStore {
  return { nodes: {}, edges: [] };
}

function nodeKey(label: string, id: string): string {
  return `${label}:${id}`;
}

/**
 * Documented fallback for FalkorDB: no Docker/container runtime and no FalkorDB Cloud
 * credentials are available on this machine (see execution/CLAUDECODE_1_CAPTURE_MEMORY.md), so
 * a live Redis-protocol connection isn't reachable. This adapter implements the same
 * `FalkorGraphClient` interface as `liveClient.ts` over a small file-backed graph store — one
 * JSON file per FalkorDB graph name under `.falkordb-fixtures/`, matching FalkorDB's own
 * per-graph isolation model (F5).
 *
 * This is NOT a general Cypher interpreter. It implements exactly the fixed set of MERGE writes
 * and F2/F3 reads whose real Cypher lives in `memory/schema/*.cypher` — those files are what
 * `liveClient.ts` sends to a real FalkorDB instance; this class produces the same logical result
 * over the same input events so swapping FALKOR_MODE=live changes nothing else.
 */
export class FixtureFalkorClient implements FalkorGraphClient {
  readonly mode = "fixture" as const;
  private readonly cache = new Map<string, GraphStore>();

  constructor(private readonly baseDir: string) {}

  private filePath(graph: string): string {
    return path.join(this.baseDir, `${graph}.json`);
  }

  private async load(graph: string): Promise<GraphStore> {
    const cached = this.cache.get(graph);
    if (cached) return cached;
    const file = this.filePath(graph);
    const store = existsSync(file) ? (JSON.parse(await readFile(file, "utf8")) as GraphStore) : emptyStore();
    this.cache.set(graph, store);
    return store;
  }

  private async save(graph: string): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
    await writeFile(this.filePath(graph), JSON.stringify(this.cache.get(graph) ?? emptyStore(), null, 2));
  }

  /**
   * Mirrors `MERGE (n:Label {id: $id}) ON CREATE SET ... ON MATCH SET ...` exactly: a fresh node
   * gets only `onCreateProps` (plus `id`); an existing node gets only `onMatchProps` applied,
   * `onCreateProps` fields are left untouched. Passing `{}` for either matches a Cypher file that
   * omits that clause.
   */
  private mergeNode(
    store: GraphStore,
    label: string,
    id: string,
    onCreateProps: Record<string, unknown>,
    onMatchProps: Record<string, unknown> = {},
  ): MutationResult {
    const key = nodeKey(label, id);
    const existing = store.nodes[key];
    if (!existing) {
      store.nodes[key] = { label, id, props: { ...onCreateProps } };
      return { nodesCreated: 1, relationshipsCreated: 0, propertiesSet: Object.keys(onCreateProps).length };
    }
    let changed = 0;
    for (const [k, v] of Object.entries(onMatchProps)) {
      if (existing.props[k] !== v) changed++;
      existing.props[k] = v;
    }
    return { nodesCreated: 0, relationshipsCreated: 0, propertiesSet: changed };
  }

  private mergeEdge(store: GraphStore, type: string, from: string, to: string): MutationResult {
    const exists = store.edges.some((e) => e.type === type && e.from === from && e.to === to);
    if (exists) return { nodesCreated: 0, relationshipsCreated: 0, propertiesSet: 0 };
    store.edges.push({ type, from, to });
    return { nodesCreated: 0, relationshipsCreated: 1, propertiesSet: 0 };
  }

  private sum(...results: MutationResult[]): MutationResult {
    return results.reduce(
      (acc, r) => ({
        nodesCreated: acc.nodesCreated + r.nodesCreated,
        relationshipsCreated: acc.relationshipsCreated + r.relationshipsCreated,
        propertiesSet: acc.propertiesSet + r.propertiesSet,
      }),
      { nodesCreated: 0, relationshipsCreated: 0, propertiesSet: 0 },
    );
  }

  async ensureSchema(graph: string): Promise<void> {
    await this.load(graph);
    await this.save(graph);
  }

  async mergeTask(graph: string, params: TaskParams): Promise<MutationResult> {
    const store = await this.load(graph);
    const { id, session_id, title, status, created_at } = params;
    // matches merge_task.cypher: ON CREATE SET session_id,title,status,created_at; ON MATCH SET status
    const result = this.mergeNode(store, "Task", id, { session_id, title, status, created_at }, { status });
    await this.save(graph);
    return result;
  }

  async mergeStep(graph: string, params: StepParams): Promise<MutationResult> {
    const store = await this.load(graph);
    const { id, task_id, order, description, status, started_at, completed_at } = params;
    // matches merge_step.cypher: ON CREATE SET task_id,order,description,status,started_at,completed_at;
    // ON MATCH SET status,completed_at; MERGE HAS_STEP; MERGE NEXT from the previous-order step.
    const nodeResult = this.mergeNode(
      store,
      "Step",
      id,
      { task_id, order, description, status, started_at, completed_at },
      { status, completed_at },
    );
    const edgeResult = this.mergeEdge(store, "HAS_STEP", nodeKey("Task", task_id), nodeKey("Step", id));
    const prevStep = Object.values(store.nodes).find((n) => n.label === "Step" && n.props.task_id === task_id && n.props.order === order - 1);
    const nextEdgeResult = prevStep ? this.mergeEdge(store, "NEXT", nodeKey("Step", prevStep.id), nodeKey("Step", id)) : { nodesCreated: 0, relationshipsCreated: 0, propertiesSet: 0 };
    await this.save(graph);
    return this.sum(nodeResult, edgeResult, nextEdgeResult);
  }

  async mergeFile(graph: string, params: FileParams): Promise<MutationResult> {
    const store = await this.load(graph);
    const { step_id, path: filePath } = params;
    // matches merge_file.cypher: MERGE File{path}, MERGE Step-[:MODIFIES]->File
    const nodeResult = this.mergeNode(store, "File", filePath, { path: filePath });
    const edgeResult = this.mergeEdge(store, "MODIFIES", nodeKey("Step", step_id), nodeKey("File", filePath));
    await this.save(graph);
    return this.sum(nodeResult, edgeResult);
  }

  async mergeDecision(graph: string, params: DecisionParams): Promise<MutationResult> {
    const store = await this.load(graph);
    const { id, step_id, task_id, text, reasoning, embedding, created_at } = params;
    // matches merge_decision.cypher: ON CREATE SET only, no ON MATCH clause; MERGE Decision-[:MADE_DURING]->Step
    const nodeResult = this.mergeNode(store, "Decision", id, { task_id, step_id, text, reasoning, embedding, created_at });
    const edgeResult = this.mergeEdge(store, "MADE_DURING", nodeKey("Decision", id), nodeKey("Step", step_id));
    await this.save(graph);
    return this.sum(nodeResult, edgeResult);
  }

  async mergeBlockerEncountered(graph: string, params: BlockerEncounteredParams): Promise<MutationResult> {
    const store = await this.load(graph);
    const { id, step_id, task_id, description, resolved, created_at, resolved_at } = params;
    // matches merge_blocker_encountered.cypher: ON CREATE SET only, no ON MATCH clause; MERGE Step-[:BLOCKED_BY]->Blocker
    const nodeResult = this.mergeNode(store, "Blocker", id, { task_id, step_id, description, resolved, created_at, resolved_at });
    const edgeResult = this.mergeEdge(store, "BLOCKED_BY", nodeKey("Step", step_id), nodeKey("Blocker", id));
    await this.save(graph);
    return this.sum(nodeResult, edgeResult);
  }

  async mergeBlockerResolved(graph: string, params: BlockerResolvedParams): Promise<MutationResult> {
    const store = await this.load(graph);
    const { id, resolved_at } = params;
    // matches merge_blocker_resolved.cypher: no ON CREATE clause, ON MATCH SET resolved=true,resolved_at
    const result = this.mergeNode(store, "Blocker", id, {}, { resolved: true, resolved_at });
    await this.save(graph);
    return result;
  }

  async contextReconstruction(graph: string, taskId: string): Promise<F2Result> {
    const store = await this.load(graph);
    const task = store.nodes[nodeKey("Task", taskId)];
    if (!task) {
      return { task_id: taskId, task_title: "", task_status: "", steps: [] };
    }
    const stepKeys = store.edges.filter((e) => e.type === "HAS_STEP" && e.from === nodeKey("Task", taskId)).map((e) => e.to);
    const steps = stepKeys
      .map((key) => store.nodes[key]!)
      .map((stepNode) => {
        const decisionKeys = store.edges.filter((e) => e.type === "MADE_DURING" && e.to === nodeKey("Step", stepNode.id)).map((e) => e.from);
        const blockerKeys = store.edges.filter((e) => e.type === "BLOCKED_BY" && e.from === nodeKey("Step", stepNode.id)).map((e) => e.to);
        const fileKeys = store.edges.filter((e) => e.type === "MODIFIES" && e.from === nodeKey("Step", stepNode.id)).map((e) => e.to);
        return {
          step_id: stepNode.id,
          step_order: Number(stepNode.props.order ?? 0),
          step_description: String(stepNode.props.description ?? ""),
          step_status: String(stepNode.props.status ?? ""),
          decisions: decisionKeys.map((k) => {
            const d = store.nodes[k]!;
            return { id: d.id, text: String(d.props.text ?? ""), reasoning: String(d.props.reasoning ?? "") };
          }),
          blockers: blockerKeys.map((k) => {
            const b = store.nodes[k]!;
            return { id: b.id, description: String(b.props.description ?? ""), resolved: Boolean(b.props.resolved) };
          }),
          files: fileKeys.map((k) => store.nodes[k]!.props.path as string),
        };
      })
      .sort((a, b) => a.step_order - b.step_order);

    return {
      task_id: task.id,
      task_title: String(task.props.title ?? ""),
      task_status: String(task.props.status ?? ""),
      steps,
    };
  }

  async blockerFileStepLookup(graph: string, taskId: string): Promise<F3Result[]> {
    const store = await this.load(graph);
    const openBlockers = Object.values(store.nodes).filter((n) => n.label === "Blocker" && n.props.task_id === taskId && n.props.resolved === false);

    return openBlockers.map((blocker) => {
      const stepEdge = store.edges.find((e) => e.type === "BLOCKED_BY" && e.to === nodeKey("Blocker", blocker.id));
      const step = stepEdge ? store.nodes[stepEdge.from] : undefined;
      const fileKeys = step ? store.edges.filter((e) => e.type === "MODIFIES" && e.from === nodeKey("Step", step.id)).map((e) => e.to) : [];
      return {
        blocker_id: blocker.id,
        blocker_description: String(blocker.props.description ?? ""),
        step_id: step?.id ?? "",
        step_description: step ? String(step.props.description ?? "") : "",
        files: fileKeys.map((k) => store.nodes[k]!.props.path as string),
      };
    });
  }

  async listBlockers(graph: string): Promise<BlockerRecord[]> {
    const store = await this.load(graph);
    return Object.values(store.nodes)
      .filter((n) => n.label === "Blocker")
      .map((n) => ({
        id: n.id,
        task_id: String(n.props.task_id ?? ""),
        description: String(n.props.description ?? ""),
        resolved: Boolean(n.props.resolved),
        step_id: String(n.props.step_id ?? ""),
      }));
  }

  async listDecisions(graph: string): Promise<DecisionRecord[]> {
    const store = await this.load(graph);
    return Object.values(store.nodes)
      .filter((n) => n.label === "Decision")
      .map((n) => {
        const stepEdge = store.edges.find((e) => e.type === "MADE_DURING" && e.from === nodeKey("Decision", n.id));
        return {
          id: n.id,
          task_id: String(n.props.task_id ?? ""),
          text: String(n.props.text ?? ""),
          reasoning: String(n.props.reasoning ?? ""),
          step_id: stepEdge ? stepEdge.to.split(":").slice(1).join(":") : "",
        };
      });
  }

  async listTaskGraphs(): Promise<string[]> {
    if (!existsSync(this.baseDir)) return [];
    const files = await readdir(this.baseDir);
    return files.filter((f) => f.startsWith("task_") && f.endsWith(".json")).map((f) => f.slice(0, -".json".length));
  }

  async countNodesByLabel(graph: string): Promise<Record<string, number>> {
    const store = await this.load(graph);
    const counts: Record<string, number> = {};
    for (const node of Object.values(store.nodes)) {
      counts[node.label] = (counts[node.label] ?? 0) + 1;
    }
    return counts;
  }

  async close(): Promise<void> {
    // no-op: file handles are opened/closed per call
  }
}
