// F2: reconstruct full task context — Task -> Steps -> Decisions (plus each step's Blockers and
// touched Files) — ordered by step order. This is what a fresh agent process runs instead of
// relying on its own local memory of "what happened so far" on this task.
//
// Properties are projected explicitly (rather than whole node objects) so the result is a flat,
// unambiguous row shape for any Cypher client to decode.
MATCH (t:Task {id: $task_id})-[:HAS_STEP]->(s:Step)
OPTIONAL MATCH (d:Decision)-[:MADE_DURING]->(s)
OPTIONAL MATCH (s)-[:BLOCKED_BY]->(b:Blocker)
OPTIONAL MATCH (s)-[:MODIFIES]->(f:File)
RETURN
  t.id AS task_id, t.title AS task_title, t.status AS task_status,
  s.id AS step_id, s.order AS step_order, s.description AS step_description, s.status AS step_status,
  collect(DISTINCT {id: d.id, text: d.text, reasoning: d.reasoning}) AS decisions,
  collect(DISTINCT {id: b.id, description: b.description, resolved: b.resolved}) AS blockers,
  collect(DISTINCT f.path) AS files
ORDER BY s.order
