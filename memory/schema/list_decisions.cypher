// Support query for F4's fallback path: fetch every Decision (text + reasoning) in one task's
// graph, plus the id of the Step it was made during, so the caller can trace decision -> step ->
// blocker without a live vector index.
MATCH (d:Decision)-[:MADE_DURING]->(s:Step)
RETURN d.id AS id, d.task_id AS task_id, d.text AS text, d.reasoning AS reasoning, s.id AS step_id
