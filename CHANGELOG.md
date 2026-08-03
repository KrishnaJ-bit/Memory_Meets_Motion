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
