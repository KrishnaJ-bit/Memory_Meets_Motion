// F1: idempotent write for the task_started event. Replay-safe (MERGE, not CREATE) — running
// this twice for the same $id is a no-op beyond the ON MATCH refresh.
MERGE (t:Task {id: $id})
ON CREATE SET
  t.session_id = $session_id,
  t.title = $title,
  t.status = $status,
  t.created_at = $created_at
ON MATCH SET
  t.status = $status
RETURN t
