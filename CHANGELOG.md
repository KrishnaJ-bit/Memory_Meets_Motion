# Changelog

All notable changes to Relay should be recorded here. Every implementation or documentation
change must add an entry under `Unreleased`, and every completed sponsor touchpoint must also add
evidence to `EXECUTION.md` Section 4.

## Unreleased

### Added

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

- Renamed `env.example` to `.env.example` so setup instructions, `AGENTS.md`, and `README.md`
  point to the same credential template path.
- Updated `README.md` and `EXECUTION.md` to link the three parallel execution files.
- Replaced the sample execution-log row with a real coordination entry tied to this documentation
  setup.
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
