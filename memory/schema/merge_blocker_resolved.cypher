// F1: idempotent write for "note" events with kind=blocker_resolved. MERGE (not a plain
// SET-after-MATCH) so this is safe to replay even if the blocker_encountered event for the same
// id hasn't been applied yet (e.g. reprocessing an out-of-order segment) — the node is created
// with what we know and filled in fully once/if blocker_encountered lands.
MERGE (b:Blocker {id: $id})
ON MATCH SET
  b.resolved = true,
  b.resolved_at = $resolved_at
RETURN b
