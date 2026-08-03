// F1: idempotent write for file_save / diff events (root EXECUTION.md Section 2: `(:File
// {path})`, edge `Step-[:MODIFIES]->File`). File nodes are keyed purely by path, so touching the
// same file across steps/tasks converges on one node — File.path is process-wide, not per-task,
// which is intentional: it's what makes "which steps/tasks touched this file" answerable later.
MATCH (s:Step {id: $step_id})
MERGE (f:File {path: $path})
MERGE (s)-[:MODIFIES]->(f)
RETURN f
