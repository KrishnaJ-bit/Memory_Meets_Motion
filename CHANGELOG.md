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
