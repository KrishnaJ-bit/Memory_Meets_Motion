import { createFalkorClient } from "../falkor/client.js";

export interface GraphIsolationReport {
  readonly graph: string;
  readonly nodeCountsByLabel: Record<string, number>;
}

/**
 * F5: confirm that two (or more) active task graphs stay isolated — querying one task's graph
 * never returns another task's nodes. Each task already lives in its own named FalkorDB graph
 * (`graphNameForTask`), so isolation holds by construction; this just makes it observable by
 * reporting per-label node counts for each graph side by side.
 */
export async function checkGraphIsolation(graphs?: readonly string[]): Promise<GraphIsolationReport[]> {
  const falkor = await createFalkorClient();
  try {
    const targets = graphs ?? (await falkor.listTaskGraphs());
    const reports: GraphIsolationReport[] = [];
    for (const graph of targets) {
      reports.push({ graph, nodeCountsByLabel: await falkor.countNodesByLabel(graph) });
    }
    return reports;
  } finally {
    await falkor.close();
  }
}
