// F1: idempotent write for step_started / step_completed events (root EXECUTION.md Section 2:
// `(:Step {id, order, description, status})`).
//
// HAS_STEP is a deliberate addition beyond Section 2's illustrative edge list — see the note atop
// src/shared/graph-contract.ts for why Task needs a direct edge to its Steps for F2 to work.
// NEXT chains steps in the order they started, matching Section 2's `Step-[:NEXT]->Step`.
MATCH (t:Task {id: $task_id})
MERGE (s:Step {id: $id})
ON CREATE SET
  s.task_id = $task_id,
  s.order = $order,
  s.description = $description,
  s.status = $status,
  s.started_at = $started_at,
  s.completed_at = $completed_at
ON MATCH SET
  s.status = $status,
  s.completed_at = $completed_at
MERGE (t)-[:HAS_STEP]->(s)
WITH t, s
OPTIONAL MATCH (t)-[:HAS_STEP]->(prev:Step {order: s.order - 1})
FOREACH (_ IN CASE WHEN prev IS NOT NULL THEN [1] ELSE [] END | MERGE (prev)-[:NEXT]->(s))
RETURN s
