// F1: idempotent write for "note" events with kind=blocker_encountered (root EXECUTION.md
// Section 2: `(:Blocker {id, description, resolved})`, edge `Step-[:BLOCKED_BY]->Blocker`).
//
// No separate Dependency node: F3's actual definition ("Find open Blocker nodes and what
// File/Step they touch") is answered by walking Step-[:BLOCKED_BY]->Blocker and
// Step-[:MODIFIES]->File from the same Step, not by a blocker->dependency edge.
MATCH (s:Step {id: $step_id})
MERGE (b:Blocker {id: $id})
ON CREATE SET
  b.task_id = $task_id,
  b.step_id = $step_id,
  b.description = $description,
  b.resolved = $resolved,
  b.created_at = $created_at,
  b.resolved_at = $resolved_at
MERGE (s)-[:BLOCKED_BY]->(b)
RETURN b
