// F3: "Find open Blocker nodes and what File/Step they touch" (root EXECUTION.md Section 1's own
// wording for F3). For every unresolved blocker on this task: which Step hit it, and which Files
// that step touches.
MATCH (s:Step)-[:BLOCKED_BY]->(b:Blocker {task_id: $task_id, resolved: false})
OPTIONAL MATCH (s)-[:MODIFIES]->(f:File)
RETURN
  b.id AS blocker_id, b.description AS blocker_description,
  s.id AS step_id, s.description AS step_description,
  collect(DISTINCT f.path) AS files
