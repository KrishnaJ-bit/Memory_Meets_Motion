import { graphNameForTask } from "../../../src/shared/graph-contract.js";
import { createFalkorClient } from "../falkor/client.js";
import type { F2Result } from "../falkor/types.js";

/**
 * F2: reconstruct a task's full context (Task -> Steps -> Decisions/Blockers) from the graph.
 * This is the function RocketRide (R1) or any fresh agent process calls instead of relying on
 * local process memory of "what happened so far" on `taskId`.
 */
export async function reconstructContext(taskId: string): Promise<F2Result> {
  const falkor = await createFalkorClient();
  try {
    return await falkor.contextReconstruction(graphNameForTask(taskId), taskId);
  } finally {
    await falkor.close();
  }
}
