# Changelog

All notable changes to Relay should be recorded here. Every implementation or documentation
change must add an entry under `Unreleased`, and every completed sponsor touchpoint must also add
evidence to `EXECUTION.md` Section 4.

## Unreleased

### Added

- Added the frozen `relay-checkout-demo` fixture under `demo/`, including the intentionally
  failing checkout rate-limit toy repo, fixture event tail, and narration script.
- Added a local autopilot presence monitor demo that watches camera motion, mouse movement,
  clicks, keyboard activity, and tab visibility before emitting a `developer_absent` handoff.
- Added TypeScript project tooling, current sponsor SDK dependencies, a local FalkorDB verifier,
  and credential setup documentation.
- Added the Track 2 orchestration workspace under `orchestration/`:
  - `src/guild/` — G1 `context-summarizer`, G2 `relay-resume`, G3 `pr-risk-review` with real run
    bodies, an audited-session runner, a registration CLI, and a `GuildTransport` seam with both
    a gateway HTTP transport and a local audit-log fallback.
  - `src/rocketride.ts` — R1/R2 runners that start every task with
    `pipelineTraceLevel: 'summary'` (without it RocketRide emits no flow traces).
  - `src/trace_ingest.ts` — converts RocketRide `apaevt_flow` component traces into LaserData L3
    `relay.agent.actions` records and a local evidence JSONL.
  - `src/laserdata.ts` — L1 replay-by-offset and L2/L3 publishing over HTTP.
  - `src/falkordb.ts` — F6 agent write-back, MERGE-only, every node tagged `author: 'agent'`.
  - `src/github.ts` — the credential-scope gate that stops G2 running with a token that reaches
    beyond the target repo, plus PR read/comment for G3.
  - `src/pipeline_lint.ts` and `src/check.ts` — offline `.pipe` validation driven by
    `.rocketride/services-catalog.json`, and the setup checker.
- Added RocketRide pipeline variables to `.env.example` under the `ROCKETRIDE_` prefix, which is
  the only prefix the engine substitutes inside `.pipe` files.

- Added three parallel execution tracks for two Claude Code builders and one Codex integrator:
  - `execution/CLAUDECODE_1_CAPTURE_MEMORY.md`
  - `execution/CLAUDECODE_2_ORCHESTRATION_PIPELINE.md`
  - `execution/CODEX_3_INTEGRATION_DEMO.md`
- Added explicit branch, path ownership, task-log, handoff, and sponsor-coverage guidance for
  LaserData, FalkorDB, Guild.ai, and RocketRide across all three tracks.
- Added `.gitignore` to keep `.env`, build outputs, dependency folders, and transient logs out of
  git while preserving `.env.example`.

### Changed

- Updated `EXECUTION.md`, `README.md`, and the Codex task log with the Phase 0 demo scenario,
  branch evidence, and setup verification.
- Updated the demo success condition around automatic autopilot activation when the developer
  leaves, matching the latest product direction.
- Updated `.env.example` with the current LaserData, Guild.ai, RocketRide, FalkorDB, GitHub, and
  LLM provider environment variable names.
- Logged the deterministic toy repo test failure as Phase 0 evidence for the Codex integration
  track.
- Logged the current integration blocker: no Track 1 or Track 2 branch exists on `origin` yet.
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
- Rewrote `pipeline/relay-capture.pipe` and `pipeline/relay-resume.pipe`. The earlier drafts used
  provider names that are control-plane tools rather than lane nodes (`tool_python`,
  `tool_github`), placed `project_id` first, and referenced environment variables without the
  `ROCKETRIDE_` prefix, so none of it would have substituted or run. Both files now validate
  against the component catalog.
- Rewrote `pipeline/README.md` and `orchestration/README.md` to describe what was built, and
  replaced the `orchestration/guild_agents.ts` scaffold with the implemented `orchestration/src/`
  modules.

### Fixed

- Corrected the LaserData integration. The first pass concluded no LaserData npm client existed
  and hand-rolled an HTTP client; the package is `@laserdata/laser-sdk`, under a scope that had
  not been tried. `orchestration/src/laserdata.ts` now uses the real SDK with
  `LASER_CONNECTION_STRING` / `LASER_STREAM`.
- Removed the LaserData `tool_http_request` nodes from both pipelines. LaserData's transport is
  Apache Iggy over TCP, so those nodes could never have published or replayed. The L1 replay now
  runs in the G2 agent and is passed to R2 as `event_tail` question context; R1 returns decisions
  as its answer and G1 publishes them to L2; L3 still comes from the trace ingester. The only
  remaining HTTP tool is the Slack notifier.
- Replaced the placeholder target repo and test command with the values frozen in
  `demo/scenario.json`.

### Notes

- Sponsor SDK status (2026-08-03): `rocketride@1.3.0`, `falkordb@6.7.0` and
  `@laserdata/laser-sdk@0.0.1` are public and used directly. Guild.ai's SDK is
  `@guildai/agents-sdk` and is **private** — it needs `guild auth login` before npm can resolve
  it, so `GuildTransport` still fronts the gateway HTTP API and its route names in
  `orchestration/src/guild/client.ts` → `ROUTES` remain the one unverified surface in this track.
