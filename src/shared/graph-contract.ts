/**
 * Graph node/edge shapes and the L2 mutation payload — the FalkorDB schema from root
 * `EXECUTION.md` Section 2, restricted to the Task/Step/Decision/File/Blocker subset F1 (in
 * Section 1) actually assigns to Track 1. (`Session`/`Person`/`Agent` nodes and F6 write-back are
 * Track 2's — see `execution/CLAUDECODE_2_ORCHESTRATION_PIPELINE.md`.)
 *
 * One deliberate addition beyond Section 2's illustrative edge list: `Task-[:HAS_STEP]->Step`.
 * Section 2 lists `Step-[:NEXT]->Step` (a chronological chain) but no edge from Task to Step at
 * all, which leaves F2 ("Traverse Task → Steps → Decisions") with no way to find a task's first
 * step. `HAS_STEP` is added so F2 is actually implementable; `NEXT` is kept too for ordering.
 */

export interface TaskNode {
  readonly id: string;
  readonly session_id: string;
  readonly title: string;
  readonly status: "open" | "completed";
  readonly created_at: string;
}

export interface StepNode {
  readonly id: string;
  readonly task_id: string;
  readonly order: number;
  readonly description: string;
  readonly status: "started" | "completed";
  readonly started_at: string;
  readonly completed_at: string | null;
}

export interface DecisionNode {
  readonly id: string;
  readonly task_id: string;
  readonly step_id: string;
  readonly text: string;
  readonly reasoning: string;
  /** null until an embedding provider is wired up (see F4 blocker note). */
  readonly embedding: readonly number[] | null;
  readonly created_at: string;
}

export interface FileNode {
  readonly path: string;
}

export interface BlockerNode {
  readonly id: string;
  readonly task_id: string;
  readonly step_id: string;
  readonly description: string;
  readonly resolved: boolean;
  readonly created_at: string;
  readonly resolved_at: string | null;
}

/** Every graph name follows this convention so F5 (per-task isolation) holds by construction. */
export function graphNameForTask(taskId: string): string {
  return `task_${taskId}`;
}

export type MutationKind = "MERGE_NODE" | "MERGE_EDGE";

/**
 * The `payload` of an L2 (`relay.graph.mutations`) event — one per applied graph write, wrapped
 * in the standard `DevSessionEvent` envelope with `event_type: "graph_write"` so L2 uses the same
 * envelope shape as every other stream (root `EXECUTION.md` Section 2 says "all streams").
 */
export interface GraphMutationPayload extends Record<string, unknown> {
  readonly graph: string;
  readonly kind: MutationKind;
  readonly cypher_file: string;
  readonly query: string;
  readonly params: Record<string, unknown>;
  readonly source_event_type: string;
  readonly nodes_created: number;
  readonly relationships_created: number;
  readonly properties_set: number;
}
