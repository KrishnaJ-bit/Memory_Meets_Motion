import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FalkorDB } from "falkordb";
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

const SCHEMA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "schema");

async function loadCypher(filename: string): Promise<string> {
  return readFile(path.join(SCHEMA_DIR, filename), "utf8");
}

function parseMetadata(metadata: readonly string[] | undefined): MutationResult {
  const get = (key: string): number => {
    const line = (metadata ?? []).find((l) => l.startsWith(key));
    if (!line) return 0;
    const match = line.match(/(\d+)/);
    return match ? Number(match[1]) : 0;
  };
  return {
    nodesCreated: get("Nodes created"),
    relationshipsCreated: get("Relationships created"),
    propertiesSet: get("Properties set"),
  };
}

/**
 * Connection options, preferring the canonical `FALKORDB_URL` (root `.env.example`, e.g.
 * `redis://[[user]:[pass]@]host:port`) and falling back to the discrete `FALKOR_HOST`/
 * `FALKOR_PORT`/`FALKOR_USERNAME`/`FALKOR_PASSWORD` vars this adapter used before that was
 * reconciled with the shared `.env.example`.
 */
function connectionOptions() {
  const url = process.env.FALKORDB_URL;
  if (url) {
    const parsed = new URL(url);
    return {
      username: parsed.username || undefined,
      password: parsed.password || undefined,
      socket: { host: parsed.hostname, port: parsed.port ? Number(parsed.port) : 6379 },
    };
  }
  return {
    username: process.env.FALKOR_USERNAME || undefined,
    password: process.env.FALKOR_PASSWORD || undefined,
    socket: {
      host: process.env.FALKOR_HOST ?? "localhost",
      port: process.env.FALKOR_PORT ? Number(process.env.FALKOR_PORT) : 6379,
    },
  };
}

/**
 * Real `falkordb` npm adapter (v6.7.0, verified against the installed package's README and
 * `dist/src/graph.d.ts`, not guessed). Requires either a local FalkorDB
 * (`docker run -p 6379:6379 falkordb/falkordb:latest`) or FalkorDB Cloud credentials. Neither
 * was available when this track started (no Docker, no Cloud API key — see
 * `execution/CLAUDECODE_1_CAPTURE_MEMORY.md`), so this class is exercised only when
 * `FALKOR_MODE=live` is set explicitly. Every write/read here sends the exact Cypher committed
 * in `memory/schema/*.cypher`.
 */
export class LiveFalkorClient implements FalkorGraphClient {
  readonly mode = "live" as const;
  private dbPromise: ReturnType<typeof FalkorDB.connect> | null = null;
  private readonly cypherCache = new Map<string, string>();

  private async db() {
    if (!this.dbPromise) {
      this.dbPromise = FalkorDB.connect(connectionOptions());
    }
    return this.dbPromise;
  }

  private async graph(name: string) {
    const db = await this.db();
    return db.selectGraph(name);
  }

  private async cypher(filename: string): Promise<string> {
    const cached = this.cypherCache.get(filename);
    if (cached) return cached;
    const text = await loadCypher(filename);
    this.cypherCache.set(filename, text);
    return text;
  }

  async ensureSchema(graph: string): Promise<void> {
    const g = await this.graph(graph);
    const text = await this.cypher("schema.cypher");
    const statements = text
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n")
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const statement of statements) {
      await g.query(statement);
    }
  }

  async mergeTask(graph: string, params: TaskParams): Promise<MutationResult> {
    const g = await this.graph(graph);
    const reply = await g.query(await this.cypher("merge_task.cypher"), { params: { ...params } });
    return parseMetadata(reply.metadata);
  }

  async mergeStep(graph: string, params: StepParams): Promise<MutationResult> {
    const g = await this.graph(graph);
    const reply = await g.query(await this.cypher("merge_step.cypher"), { params: { ...params } });
    return parseMetadata(reply.metadata);
  }

  async mergeFile(graph: string, params: FileParams): Promise<MutationResult> {
    const g = await this.graph(graph);
    const reply = await g.query(await this.cypher("merge_file.cypher"), { params: { ...params } });
    return parseMetadata(reply.metadata);
  }

  async mergeDecision(graph: string, params: DecisionParams): Promise<MutationResult> {
    const g = await this.graph(graph);
    const reply = await g.query(await this.cypher("merge_decision.cypher"), { params: { ...params } });
    return parseMetadata(reply.metadata);
  }

  async mergeBlockerEncountered(graph: string, params: BlockerEncounteredParams): Promise<MutationResult> {
    const g = await this.graph(graph);
    const reply = await g.query(await this.cypher("merge_blocker_encountered.cypher"), { params: { ...params } });
    return parseMetadata(reply.metadata);
  }

  async mergeBlockerResolved(graph: string, params: BlockerResolvedParams): Promise<MutationResult> {
    const g = await this.graph(graph);
    const reply = await g.query(await this.cypher("merge_blocker_resolved.cypher"), { params: { ...params } });
    return parseMetadata(reply.metadata);
  }

  async contextReconstruction(graph: string, taskId: string): Promise<F2Result> {
    const g = await this.graph(graph);
    const reply = await g.query(await this.cypher("f2_context_reconstruction.cypher"), { params: { task_id: taskId } });
    const rows = (reply.data ?? []) as unknown as Array<Record<string, unknown>>;
    if (rows.length === 0) {
      return { task_id: taskId, task_title: "", task_status: "", steps: [] };
    }
    const first = rows[0]!;
    return {
      task_id: String(first.task_id ?? taskId),
      task_title: String(first.task_title ?? ""),
      task_status: String(first.task_status ?? ""),
      steps: rows.map((row) => ({
        step_id: String(row.step_id ?? ""),
        step_order: Number(row.step_order ?? 0),
        step_description: String(row.step_description ?? ""),
        step_status: String(row.step_status ?? ""),
        decisions: (row.decisions as F2Result["steps"][number]["decisions"]) ?? [],
        blockers: (row.blockers as F2Result["steps"][number]["blockers"]) ?? [],
        files: (row.files as readonly string[]) ?? [],
      })),
    };
  }

  async blockerFileStepLookup(graph: string, taskId: string): Promise<F3Result[]> {
    const g = await this.graph(graph);
    const reply = await g.query(await this.cypher("f3_blocker_file_step_lookup.cypher"), { params: { task_id: taskId } });
    const rows = (reply.data ?? []) as unknown as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      blocker_id: String(row.blocker_id ?? ""),
      blocker_description: String(row.blocker_description ?? ""),
      step_id: String(row.step_id ?? ""),
      step_description: String(row.step_description ?? ""),
      files: (row.files as readonly string[]) ?? [],
    }));
  }

  async listBlockers(graph: string): Promise<BlockerRecord[]> {
    const g = await this.graph(graph);
    const reply = await g.query(await this.cypher("list_blockers.cypher"));
    const rows = (reply.data ?? []) as unknown as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id ?? ""),
      task_id: String(row.task_id ?? ""),
      description: String(row.description ?? ""),
      resolved: Boolean(row.resolved),
      step_id: String(row.step_id ?? ""),
    }));
  }

  async listDecisions(graph: string): Promise<DecisionRecord[]> {
    const g = await this.graph(graph);
    const reply = await g.query(await this.cypher("list_decisions.cypher"));
    const rows = (reply.data ?? []) as unknown as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id ?? ""),
      task_id: String(row.task_id ?? ""),
      text: String(row.text ?? ""),
      reasoning: String(row.reasoning ?? ""),
      step_id: String(row.step_id ?? ""),
    }));
  }

  async listTaskGraphs(): Promise<string[]> {
    const db = await this.db();
    const graphs = await db.list();
    return graphs.filter((name: string) => name.startsWith("task_"));
  }

  async countNodesByLabel(graph: string): Promise<Record<string, number>> {
    const g = await this.graph(graph);
    const reply = await g.query(await this.cypher("graph_node_counts.cypher"));
    const rows = (reply.data ?? []) as unknown as Array<{ label: string; count: number }>;
    const counts: Record<string, number> = {};
    for (const row of rows) counts[row.label] = Number(row.count);
    return counts;
  }

  async close(): Promise<void> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      await db.close();
    }
  }
}
