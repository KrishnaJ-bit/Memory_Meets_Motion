// Support query for F3/F4: fetch every Blocker in one task's graph, plus the id of the Step it
// blocks (via Step-[:BLOCKED_BY]->Blocker) so F4's fallback can join decisions to blockers on a
// shared step_id instead of guessing.
MATCH (s:Step)-[:BLOCKED_BY]->(b:Blocker)
RETURN b.id AS id, b.task_id AS task_id, b.description AS description, b.resolved AS resolved, s.id AS step_id
