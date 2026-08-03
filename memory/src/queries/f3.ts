import { graphNameForTask } from "../../../src/shared/graph-contract.js";
import { createFalkorClient } from "../falkor/client.js";
import type { F3Result } from "../falkor/types.js";

/**
 * F3: "Find open Blocker nodes and what File/Step they touch" (root EXECUTION.md Section 1's own
 * wording for F3). For every unresolved blocker on `taskId`: which step hit it, and which files
 * that step modifies — the context an agent needs before it can even start on the blocker.
 */
export async function lookupOpenBlockers(taskId: string): Promise<F3Result[]> {
  const falkor = await createFalkorClient();
  try {
    return await falkor.blockerFileStepLookup(graphNameForTask(taskId), taskId);
  } finally {
    await falkor.close();
  }
}
