import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertDevSessionEvent, type DevSessionEvent, type NoteKind } from "../../src/shared/envelope.js";
import { graphNameForTask, type GraphMutationPayload, type MutationKind } from "../../src/shared/graph-contract.js";
import { createLaserClient, L1_STREAM, L1_TOPIC, L2_STREAM, L2_TOPIC } from "../../capture/src/laser/client.js";
import { createFalkorClient } from "./falkor/client.js";
import type { FalkorGraphClient, MutationResult } from "./falkor/types.js";

const SCHEMA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "schema");
const cypherCache = new Map<string, string>();
async function cypherText(filename: string): Promise<string> {
  const cached = cypherCache.get(filename);
  if (cached) return cached;
  const text = await readFile(path.join(SCHEMA_DIR, filename), "utf8");
  cypherCache.set(filename, text);
  return text;
}

export interface ConsumeSummary {
  readonly eventsProcessed: number;
  readonly mutationsApplied: number;
  readonly graphsTouched: string[];
}

const ensuredSchemas = new Set<string>();

async function ensureSchemaOnce(falkor: FalkorGraphClient, graph: string): Promise<void> {
  if (ensuredSchemas.has(graph)) return;
  await falkor.ensureSchema(graph);
  ensuredSchemas.add(graph);
}

interface Applied {
  readonly graph: string;
  readonly kind: MutationKind;
  readonly cypherFile: string;
  readonly params: Record<string, unknown>;
  readonly result: MutationResult;
}

/**
 * F1: applies one L1 event to FalkorDB. L1 only carries 4 wire event types
 * (`file_save | terminal_cmd | diff | note`); `note`'s `payload.kind` carries the actual
 * task/step lifecycle, decision, and blocker semantics (see src/shared/envelope.ts).
 * `terminal_cmd` isn't part of the F1 node list (Task/Step/Decision/File/Blocker) and is captured
 * durably in L1 but not mirrored to the graph.
 */
async function applyEvent(falkor: FalkorGraphClient, event: DevSessionEvent): Promise<Applied | null> {
  const graph = graphNameForTask(event.task_id);
  await ensureSchemaOnce(falkor, graph);
  const p = event.payload;

  switch (event.event_type) {
    case "file_save":
    case "diff": {
      const params = { step_id: String(p.step_id), path: String(p.path) };
      return { graph, kind: "MERGE_NODE", cypherFile: "merge_file.cypher", params, result: await falkor.mergeFile(graph, params) };
    }
    case "terminal_cmd":
      return null;
    case "note": {
      const kind = p.kind as NoteKind;
      switch (kind) {
        case "task_started": {
          const params = { id: event.task_id, session_id: event.session_id, title: String(p.title ?? ""), status: "open" as const, created_at: event.timestamp };
          return { graph, kind: "MERGE_NODE", cypherFile: "merge_task.cypher", params, result: await falkor.mergeTask(graph, params) };
        }
        case "task_completed": {
          const params = { id: event.task_id, session_id: event.session_id, title: String(p.title ?? ""), status: "completed" as const, created_at: event.timestamp };
          return { graph, kind: "MERGE_NODE", cypherFile: "merge_task.cypher", params, result: await falkor.mergeTask(graph, params) };
        }
        case "step_started": {
          const params = { id: String(p.step_id), task_id: event.task_id, order: Number(p.order ?? 0), description: String(p.description ?? ""), status: "started" as const, started_at: event.timestamp, completed_at: null };
          return { graph, kind: "MERGE_NODE", cypherFile: "merge_step.cypher", params, result: await falkor.mergeStep(graph, params) };
        }
        case "step_completed": {
          // order is ignored by merge_step.cypher's ON MATCH clause; 0 is a safe placeholder since
          // the real order was already set when step_started created this node.
          const params = { id: String(p.step_id), task_id: event.task_id, order: 0, description: String(p.description ?? ""), status: "completed" as const, started_at: event.timestamp, completed_at: event.timestamp };
          return { graph, kind: "MERGE_NODE", cypherFile: "merge_step.cypher", params, result: await falkor.mergeStep(graph, params) };
        }
        case "decision": {
          const params = {
            id: `${p.step_id}:decision:${event.timestamp}`,
            task_id: event.task_id,
            step_id: String(p.step_id),
            text: String(p.text ?? ""),
            reasoning: String(p.reasoning ?? ""),
            embedding: null,
            created_at: event.timestamp,
          };
          return { graph, kind: "MERGE_NODE", cypherFile: "merge_decision.cypher", params, result: await falkor.mergeDecision(graph, params) };
        }
        case "blocker_encountered": {
          const params = {
            id: String(p.blocker_id),
            task_id: event.task_id,
            step_id: String(p.step_id),
            description: String(p.description ?? ""),
            resolved: false as const,
            created_at: event.timestamp,
            resolved_at: null,
          };
          return { graph, kind: "MERGE_NODE", cypherFile: "merge_blocker_encountered.cypher", params, result: await falkor.mergeBlockerEncountered(graph, params) };
        }
        case "blocker_resolved": {
          const params = { id: String(p.blocker_id), resolved_at: event.timestamp };
          return { graph, kind: "MERGE_NODE", cypherFile: "merge_blocker_resolved.cypher", params, result: await falkor.mergeBlockerResolved(graph, params) };
        }
        default: {
          const _exhaustive: never = kind;
          throw new Error(`unhandled note kind ${String(_exhaustive)}`);
        }
      }
    }
    case "graph_write":
    case "agent_action":
      // These are L2/L3 event types, never produced by the L1 simulator; nothing to apply.
      return null;
    default: {
      const _exhaustive: never = event.event_type;
      throw new Error(`unhandled event_type ${String(_exhaustive)}`);
    }
  }
}

/**
 * Consumes L1 (`dev.session.events`) from `fromOffset`, applies each event to FalkorDB with
 * MERGE-only writes, and mirrors every applied graph write to L2 (`relay.graph.mutations`) as a
 * `graph_write` event using the same envelope as every other stream. Safe to re-run from the same
 * offset: every write is a MERGE, so replay never duplicates state.
 */
export async function consumeL1ToGraph(fromOffset = 0): Promise<ConsumeSummary> {
  const laser = await createLaserClient();
  const falkor = await createFalkorClient();
  await laser.ensure(L1_STREAM, L1_TOPIC);
  await laser.ensure(L2_STREAM, L2_TOPIC);

  const records = await laser.replayFromOffset(L1_STREAM, L1_TOPIC, fromOffset);
  const graphsTouched = new Set<string>();
  let mutationsApplied = 0;

  // Both clients must close even when a mutation throws: a live FalkorDB client
  // holds an open socket, so an escaping error would otherwise leave the process
  // hanging instead of failing.
  try {
    for (const record of records) {
      const event = record.payload;
      assertDevSessionEvent(event);
      const applied = await applyEvent(falkor, event);
      if (!applied) continue;

      graphsTouched.add(applied.graph);
      mutationsApplied++;

      const mutationPayload: GraphMutationPayload = {
        graph: applied.graph,
        kind: applied.kind,
        cypher_file: applied.cypherFile,
        query: await cypherText(applied.cypherFile),
        params: applied.params,
        source_event_type: event.event_type,
        nodes_created: applied.result.nodesCreated,
        relationships_created: applied.result.relationshipsCreated,
        properties_set: applied.result.propertiesSet,
      };
      const mutationEvent: DevSessionEvent<GraphMutationPayload> = {
        session_id: event.session_id,
        task_id: event.task_id,
        event_type: "graph_write",
        timestamp: new Date().toISOString(),
        payload: mutationPayload,
      };
        await laser.publish(L2_STREAM, L2_TOPIC, mutationEvent);
    }
  } finally {
    await falkor.close();
    await laser.close();
  }

  return { eventsProcessed: records.length, mutationsApplied, graphsTouched: [...graphsTouched] };
}
