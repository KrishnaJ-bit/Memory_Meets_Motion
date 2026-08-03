// F4: "Hybrid graph + vector query — find similar past-resolved blockers (vector similarity over
// Decision embeddings) as precedent for the agent" (root EXECUTION.md Section 1's own wording).
// Live-mode form: embed the new blocker's description, vector-search Decision.embedding for
// similar past decisions, then walk Decision-[:MADE_DURING]->Step-[:BLOCKED_BY]->Blocker to find
// which (now-resolved) blocker each similar decision was made while resolving.
//
// "Similar" spans *all* tasks, but each task lives in its own isolated graph (F5), so this query
// is run once per task graph (the caller lists graphs via `GRAPH.LIST` / `db.list()`, filters to
// the `task_*` prefix, runs this against each, and merges+ranks the per-graph hits) rather than
// as one cross-graph query — FalkorDB does not support querying multiple graphs in a single
// Cypher statement.
//
// BLOCKED on this machine: no embedding provider credentials means no `Decision.embedding`
// vectors exist to query against. `memory/src/queries/f4.ts` documents and uses a keyword-
// overlap fallback (over Decision.text/reasoning, same traversal shape) instead of this query
// until a live FalkorDB + embedding provider are wired up.
CALL db.idx.vector.queryNodes('Decision', 'embedding', $k, $query_vector)
YIELD node AS decision, score
MATCH (decision)-[:MADE_DURING]->(s:Step)-[:BLOCKED_BY]->(b:Blocker {resolved: true})
RETURN b.id AS blocker_id, b.description AS blocker_description, decision.text AS decision_text, score
ORDER BY score DESC
