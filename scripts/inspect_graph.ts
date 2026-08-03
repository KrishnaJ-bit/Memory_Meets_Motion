#!/usr/bin/env -S npx tsx
import { reconstructContext } from "../memory/src/queries/f2.js";
import { lookupOpenBlockers } from "../memory/src/queries/f3.js";
import { findSimilarResolvedBlockers } from "../memory/src/queries/f4.js";
import { checkGraphIsolation } from "../memory/src/queries/f5.js";

async function main() {
  const taskId = process.argv[2];
  if (!taskId) {
    console.error("usage: inspect_graph.ts <task_id> [<second_task_id>]");
    process.exitCode = 1;
    return;
  }
  const secondTaskId = process.argv[3];

  console.log("=== F2: context reconstruction (Task -> Steps -> Decisions/Blockers/Files) ===");
  console.log(JSON.stringify(await reconstructContext(taskId), null, 2));

  console.log("\n=== F3: open Blocker nodes and what File/Step they touch ===");
  console.log(JSON.stringify(await lookupOpenBlockers(taskId), null, 2));

  console.log("\n=== F4: similar past-resolved blocker lookup (keyword-overlap fallback; see f4.ts) ===");
  console.log(JSON.stringify(await findSimilarResolvedBlockers("Node.js version requirement blocking the SDK", 5), null, 2));

  console.log("\n=== F5: per-task graph isolation ===");
  const graphs = secondTaskId ? [`task_${taskId}`, `task_${secondTaskId}`] : undefined;
  console.log(JSON.stringify(await checkGraphIsolation(graphs), null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
