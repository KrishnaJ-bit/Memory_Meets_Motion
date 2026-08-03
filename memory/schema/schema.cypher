// FalkorDB schema for one task graph (see graphNameForTask in src/shared/graph-contract.ts —
// each task gets its own graph, e.g. "task_96bb478e", so F5 isolation holds by construction).
// Node/edge shape is the Task/Step/Decision/File/Blocker subset of root EXECUTION.md Section 2
// that F1 (Section 1) assigns to Track 1. Applied idempotently once per graph, the first time
// that graph is written to.
//
// Syntax verified 2026-08-03 against https://docs.falkordb.com/cypher/indexing/range-index.html
// and .../vector-index.html (installed `falkordb` npm client is v6.7.0, protocol-compatible).

CREATE INDEX FOR (t:Task) ON (t.id);
CREATE INDEX FOR (s:Step) ON (s.id);
CREATE INDEX FOR (s:Step) ON (s.task_id);
CREATE INDEX FOR (d:Decision) ON (d.id);
CREATE INDEX FOR (f:File) ON (f.path);
CREATE INDEX FOR (b:Blocker) ON (b.id);
CREATE INDEX FOR (b:Blocker) ON (b.resolved);

// F4 (similar past-resolved blocker lookup) wants a vector index over Decision embeddings
// (root EXECUTION.md Section 2: `(:Decision {id, text, reasoning, embedding})`).
// BLOCKED on this machine: no embedding provider credentials, so no vectors are produced.
// This index is declared for when a live FalkorDB + embedding provider are available; until
// then `memory/src/queries/f4.ts` runs a documented keyword-overlap fallback instead
// (see execution/CLAUDECODE_1_CAPTURE_MEMORY.md for the blocker note).
CREATE VECTOR INDEX FOR (d:Decision) ON (d.embedding) OPTIONS {dimension:8, similarityFunction:'cosine'};
