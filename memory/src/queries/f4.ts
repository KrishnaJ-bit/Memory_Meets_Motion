import { createFalkorClient } from "../falkor/client.js";

export interface SimilarResolvedBlockerHit {
  readonly graph: string;
  readonly blocker_id: string;
  readonly blocker_description: string;
  readonly via_decision_id: string;
  readonly via_decision_text: string;
  readonly score: number;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2),
  );
}

/** Jaccard similarity over tokenized text: |intersection| / |union|. */
function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * F4: "Hybrid graph + vector query — find similar past-resolved blockers (vector similarity over
 * Decision embeddings) as precedent for the agent" (root EXECUTION.md Section 1's own wording).
 * Given a new blocker's description, find past Decisions with similar text/reasoning, then walk
 * decision -> step -> blocker (same traversal `memory/schema/f4_similar_resolved_blocker_lookup.cypher`
 * uses) to surface which *resolved* blocker that decision helped close — the idea being "a
 * similar decision was made resolving blocker X, so its resolution may apply here too."
 *
 * Per-task graph isolation (F5) means there's no single Cypher query spanning all tasks, so this
 * lists every `task_*` graph and scores candidates in-process.
 *
 * BLOCKED on this machine: no embedding provider credentials, so there's no `Decision.embedding`
 * to vector-search (see `execution/CLAUDECODE_1_CAPTURE_MEMORY.md`). This function uses a
 * documented keyword-overlap (Jaccard) fallback over `Decision.text`/`reasoning` instead, with the
 * same decision->step->blocker traversal the live Cypher would use. Swapping in real embeddings
 * later only changes the scoring function — callers of `findSimilarResolvedBlockers` don't change.
 */
export async function findSimilarResolvedBlockers(newBlockerDescription: string, k = 5): Promise<SimilarResolvedBlockerHit[]> {
  const falkor = await createFalkorClient();
  try {
    const queryTokens = tokenize(newBlockerDescription);
    const graphs = await falkor.listTaskGraphs();
    const hits: SimilarResolvedBlockerHit[] = [];
    for (const graph of graphs) {
      const [decisions, blockers] = await Promise.all([falkor.listDecisions(graph), falkor.listBlockers(graph)]);
      const resolvedBlockersByStep = new Map(blockers.filter((b) => b.resolved).map((b) => [b.step_id, b] as const));
      for (const decision of decisions) {
        const resolvedBlocker = resolvedBlockersByStep.get(decision.step_id);
        if (!resolvedBlocker) continue; // no resolved blocker made-during-the-same-step as this decision
        const score = similarity(queryTokens, tokenize(`${decision.text} ${decision.reasoning}`));
        if (score <= 0) continue;
        hits.push({
          graph,
          blocker_id: resolvedBlocker.id,
          blocker_description: resolvedBlocker.description,
          via_decision_id: decision.id,
          via_decision_text: decision.text,
          score,
        });
      }
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, k);
  } finally {
    await falkor.close();
  }
}
