# Changelog

All notable changes to Relay should be recorded here. Every implementation or documentation
change must add an entry under `Unreleased`, and every completed sponsor touchpoint must also add
evidence to `EXECUTION.md` Section 4.

## Unreleased

### Added

- Added three parallel execution tracks for two Claude Code builders and one Codex integrator:
  - `execution/CLAUDECODE_1_CAPTURE_MEMORY.md`
  - `execution/CLAUDECODE_2_ORCHESTRATION_PIPELINE.md`
  - `execution/CODEX_3_INTEGRATION_DEMO.md`
- Added explicit branch, path ownership, task-log, handoff, and sponsor-coverage guidance for
  LaserData, FalkorDB, Guild.ai, and RocketRide across all three tracks.
- Added `.gitignore` to keep `.env`, build outputs, dependency folders, and transient logs out of
  git while preserving `.env.example`.

### Changed

- Renamed `env.example` to `.env.example` so setup instructions, `AGENTS.md`, and `README.md`
  point to the same credential template path.
- Updated `README.md` and `EXECUTION.md` to link the three parallel execution files.
- Replaced the sample execution-log row with a real coordination entry tied to this documentation
  setup.

### Track 1 — Claude Code #1 — Capture + Memory

- Added shared event envelope (`src/shared/envelope.ts`) and graph contract
  (`src/shared/graph-contract.ts`) matching root `EXECUTION.md` Section 2's `event_type` enum
  (`file_save | terminal_cmd | diff | note | graph_write | agent_action`) and FalkorDB
  Task/Step/Decision/File/Blocker node shape, including `graphNameForTask` (F5 isolation by
  construction) and `GraphMutationPayload` (L2's `graph_write` payload shape).
- Added session simulator (`capture/src/simulator.ts`) emitting realistic, reproducible
  L1 event sequences on the 4 canonical wire event types (26 events per task).
- Added LaserData stream adapter (`capture/src/laser/`): `LaserStreamClient` interface, a real
  `@laserdata/laser-sdk` adapter, and a file-backed fixture adapter (default), switched via
  `LASER_MODE`.
- Added `scripts/simulate_session.ts`, `scripts/replay_l1.ts`, `scripts/replay_l2.ts` — publish
  and replay-from-offset CLIs for L1 `dev.session.events` and L2 `relay.graph.mutations`.
- Added FalkorDB schema and query Cypher (`memory/schema/*.cypher`): MERGE-only writes for
  Task/Step/Decision/File/Blocker (with `HAS_STEP`/`NEXT`/`MODIFIES`/`BLOCKED_BY`/`MADE_DURING`
  edges), F2 context reconstruction, F3 open-blocker/file/step lookup, F4's vector-index form
  over `Decision.embedding`, and an F5 per-graph node-count support query.
- Added FalkorDB graph adapter (`memory/src/falkor/`): `FalkorGraphClient` interface, a real
  `falkordb` adapter, and a file-backed fixture adapter with ON CREATE/ON MATCH parity to the
  Cypher files, switched via `FALKOR_MODE`.
- Added `memory/src/consumer.ts`: L1 -> FalkorDB consumer dispatched by `event_type`/`note.kind`,
  mirroring every applied mutation to L2 as a `graph_write` event in the standard envelope.
- Added `memory/src/queries/{f2,f3,f4,f5}.ts` — standalone, pipeline-node-callable functions for
  context reconstruction, open-blocker lookup, similar-past-resolved-blocker lookup (keyword
  fallback pending an embedding provider, joined via shared `step_id`), and per-task graph
  isolation checks.
- Added `scripts/seed_graph.ts`, `scripts/inspect_graph.ts`, `scripts/build_fixtures.ts`.
- Reconciled LaserData/FalkorDB env var names between this track's adapters and root
  `.env.example` (`LASERDATA_STREAM_URL`/`LASER_CONNECTION_STRING`, `FALKORDB_URL`/discrete
  `FALKOR_*` vars) — see `.env.example` comments for what's actually consumed vs. illustrative.
- Packaged `fixtures/` (event fixture, L2 mutation sample, F2/F3 sample output, `fixtures/README.md`)
  as the stable Track 2/Track 3 handoff location.
- Documented the missing-Docker/missing-credentials blocker, the fixture fallback design, and a
  schema-reconciliation note (an earlier pass designed its own event/graph schema before this
  track's session discovered the real `origin/main`; everything was rewritten to match before any
  other track built against it) in `execution/CLAUDECODE_1_CAPTURE_MEMORY.md`.
- Extended `.gitignore` with this track's runtime fixture stores (`.laserdata-fixtures/`,
  `.falkordb-fixtures/`, `.fixture-build/`) and RocketRide's vendored local catalog (`.rocketride/`).
