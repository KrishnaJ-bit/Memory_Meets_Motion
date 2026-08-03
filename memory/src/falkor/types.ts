export interface MutationResult {
  readonly nodesCreated: number;
  readonly relationshipsCreated: number;
  readonly propertiesSet: number;
}

export interface TaskParams {
  readonly id: string;
  readonly session_id: string;
  readonly title: string;
  readonly status: "open" | "completed";
  readonly created_at: string;
}

export interface StepParams {
  readonly id: string;
  readonly task_id: string;
  readonly order: number;
  readonly description: string;
  readonly status: "started" | "completed";
  readonly started_at: string;
  readonly completed_at: string | null;
}

export interface FileParams {
  readonly step_id: string;
  readonly path: string;
}

export interface DecisionParams {
  readonly id: string;
  readonly task_id: string;
  readonly step_id: string;
  readonly text: string;
  readonly reasoning: string;
  readonly embedding: number[] | null;
  readonly created_at: string;
}

export interface BlockerEncounteredParams {
  readonly id: string;
  readonly task_id: string;
  readonly step_id: string;
  readonly description: string;
  readonly resolved: false;
  readonly created_at: string;
  readonly resolved_at: null;
}

export interface BlockerResolvedParams {
  readonly id: string;
  readonly resolved_at: string;
}

export interface BlockerRecord {
  readonly id: string;
  readonly task_id: string;
  readonly description: string;
  readonly resolved: boolean;
  readonly step_id: string;
}

export interface DecisionRecord {
  readonly id: string;
  readonly task_id: string;
  readonly text: string;
  readonly reasoning: string;
  readonly step_id: string;
}

export interface F2Step {
  readonly step_id: string;
  readonly step_order: number;
  readonly step_description: string;
  readonly step_status: string;
  readonly decisions: ReadonlyArray<{ id: string; text: string; reasoning: string }>;
  readonly blockers: ReadonlyArray<{ id: string; description: string; resolved: boolean }>;
  readonly files: readonly string[];
}

export interface F2Result {
  readonly task_id: string;
  readonly task_title: string;
  readonly task_status: string;
  readonly steps: readonly F2Step[];
}

/** F3: "Find open Blocker nodes and what File/Step they touch." */
export interface F3Result {
  readonly blocker_id: string;
  readonly blocker_description: string;
  readonly step_id: string;
  readonly step_description: string;
  readonly files: readonly string[];
}

/**
 * Adapter boundary between memory/ code and FalkorDB. Both the live SDK adapter and the local
 * fixture adapter implement this so F2/F3/F4/F5 callers never branch on which one is active.
 */
export interface FalkorGraphClient {
  readonly mode: "live" | "fixture";
  ensureSchema(graph: string): Promise<void>;
  mergeTask(graph: string, params: TaskParams): Promise<MutationResult>;
  mergeStep(graph: string, params: StepParams): Promise<MutationResult>;
  mergeFile(graph: string, params: FileParams): Promise<MutationResult>;
  mergeDecision(graph: string, params: DecisionParams): Promise<MutationResult>;
  mergeBlockerEncountered(graph: string, params: BlockerEncounteredParams): Promise<MutationResult>;
  mergeBlockerResolved(graph: string, params: BlockerResolvedParams): Promise<MutationResult>;
  /** F2 */
  contextReconstruction(graph: string, taskId: string): Promise<F2Result>;
  /** F3 */
  blockerFileStepLookup(graph: string, taskId: string): Promise<F3Result[]>;
  /** Support for F4's fallback scoring. */
  listBlockers(graph: string): Promise<BlockerRecord[]>;
  listDecisions(graph: string): Promise<DecisionRecord[]>;
  /** Support for F4 (cross-graph aggregation) and F5 (isolation check). */
  listTaskGraphs(): Promise<string[]>;
  /** F5: per-label node counts for one graph, used to prove two task graphs stay isolated. */
  countNodesByLabel(graph: string): Promise<Record<string, number>>;
  close(): Promise<void>;
}
