// F1: idempotent write for "note" events with kind=decision. Part of the Task -> Step -> Decision
// chain that F2 (context reconstruction) walks. Field names and the edge direction
// (Decision-[:MADE_DURING]->Step) match root EXECUTION.md Section 2 exactly.
//
// $embedding is null until an embedding provider is wired up (see the F4 blocker note in
// execution/CLAUDECODE_1_CAPTURE_MEMORY.md) — the property exists from the start so a later
// backfill is a plain UPDATE, not a schema migration.
MATCH (s:Step {id: $step_id})
MERGE (d:Decision {id: $id})
ON CREATE SET
  d.task_id = $task_id,
  d.step_id = $step_id,
  d.text = $text,
  d.reasoning = $reasoning,
  d.embedding = $embedding,
  d.created_at = $created_at
MERGE (d)-[:MADE_DURING]->(s)
RETURN d
