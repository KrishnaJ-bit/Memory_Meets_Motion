# Codex Track 3 - Integration + Demo + Release

Owner tool: Codex

Mission: keep the build coherent while Tracks 1 and 2 move in parallel, then integrate the full
Relay demo, evidence trail, changelog, deck inputs, and final submission assets.

## Start Here

1. Read `AGENTS.md`, `EXECUTION.md`, `CHANGELOG.md`, and this file before editing.
2. Work on branch `feature/codex-integration-demo`.
3. Keep the demo scenario in `EXECUTION.md` Section 5 frozen after Phase 0.
4. Pull both Claude Code branches before integration and preserve both sets of log evidence.
5. Update the task log below after every meaningful step.
6. Update `CHANGELOG.md` for every committed change.
7. Add real evidence to `EXECUTION.md` Section 4 for each completed sponsor touchpoint.

## Claimed Paths

Primary paths:

- `demo/`
- `docs/`, if added for screenshots, architecture notes, or evidence packs
- `slides/`, if the deck is kept in-repo
- `README.md`
- `EXECUTION.md`
- `CHANGELOG.md`
- `execution/CODEX_3_INTEGRATION_DEMO.md`

Avoid editing unless integrating or unblocking:

- `capture/`
- `memory/`
- `orchestration/`
- `pipeline/`
- `agents/`

## Sponsor Coverage

| Sponsor | Owned or supported work | Required evidence |
|---|---|---|
| LaserData | Verify L1/L2/L3 together, replay-from-offset, and event evidence in the final run. | Offsets, stream names, event counts, replay output. |
| FalkorDB | Verify F1-F6 together, screenshots, per-task graph isolation, and agent write-back. | Query output, Browser screenshot path, graph names. |
| Guild.ai | Verify G1-G3 sessions, manual trigger, idle-timeout trigger, and PR review trigger. | Session IDs, trigger IDs, dashboard screenshot path. |
| RocketRide | Verify R1/R2 traces, multi-model routing, retry loop, and pipeline screenshots. | Trace IDs, pipeline file paths, retry evidence, screenshot path. |

## Work Plan

- [ ] Create or confirm the toy demo repo and deterministic feature arc in `EXECUTION.md` Section 5.
- [ ] Build the demo fixture data and narration script without changing the sponsor usage matrix.
- [ ] Keep the `README.md` setup path current as implementation paths become real.
- [ ] Merge Track 1 outputs and run capture/memory smoke checks.
- [ ] Merge Track 2 outputs and run orchestration/pipeline smoke checks.
- [ ] Run the full chain: simulator -> LaserData -> FalkorDB -> Guild trigger -> RocketRide -> PR.
- [ ] Verify all Section 1 sponsor rows have real evidence in `EXECUTION.md` Section 4.
- [ ] Record one clean backup run to `demo/backup.mp4`.
- [ ] Save FalkorDB, Guild.ai, and RocketRide screenshots for the deck.
- [ ] Prepare the 4-5 slide content with concrete sponsor-by-sponsor usage.
- [ ] Confirm repo is pushed and submission assets are ready.

## Integration Rules

- Keep one merge branch at a time; pull `origin/main`, merge a track branch, resolve, test, then
  merge the next.
- If two logs conflict, keep both rows and order by timestamp.
- If a sponsor SDK blocks the build, document the exact command/error, activate the Section 6
  fallback, and mark the relevant checklist item `[blocked]` with a one-line reason.
- Do not mark a sponsor touchpoint complete until it has a real run ID, payload, offset, query
  result, screenshot path, or file path.

## Task Log

| # | Time | Action | Sponsors | Evidence | Status |
|---|---|---|---|---|---|
| 1 | 2026-08-03 11:19 PDT | Track created and assigned to Codex. | LaserData, FalkorDB, Guild.ai, RocketRide | `execution/CODEX_3_INTEGRATION_DEMO.md` | ready |
| | | | | | |

## Change Discipline

Every code or doc change must update `CHANGELOG.md`. Every completed runtime sponsor touchpoint
must update `EXECUTION.md` Section 4 with real evidence, not a placeholder.
