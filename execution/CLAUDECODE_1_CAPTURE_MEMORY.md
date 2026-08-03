# Claude Code Track 1 - Capture + Memory

Owner tool: Claude Code #1

Mission: build the event capture layer and the FalkorDB memory layer so Relay can prove what
happened, replay it, and reconstruct task context without relying on local process memory.

## Start Here

1. Read `AGENTS.md`, `EXECUTION.md`, `CHANGELOG.md`, and this file before editing.
2. Work on branch `feature/claudecode-capture-memory`.
3. Confirm current LaserData and FalkorDB SDK/client commands from live docs or `--help` before
   writing integration code.
4. Update the task log below after every meaningful step.
5. Update `CHANGELOG.md` for every committed change.
6. Add real evidence to `EXECUTION.md` Section 4 for each completed sponsor touchpoint.

## Claimed Paths

Primary paths:

- `capture/`
- `memory/`
- `scripts/` files used for session simulation, replay, graph seeding, or graph inspection
- `src/shared/` event-envelope and graph-contract files, if a shared TypeScript package is added
- `execution/CLAUDECODE_1_CAPTURE_MEMORY.md`

Avoid editing unless coordinated:

- `orchestration/`
- `pipeline/`
- `demo/`
- `README.md`, `EXECUTION.md`, and `CHANGELOG.md` outside required log/changelog rows

## Sponsor Coverage

| Sponsor | Owned or supported work | Required evidence |
|---|---|---|
| LaserData | Own L1 `dev.session.events`; own L2 `relay.graph.mutations`; expose replay-from-offset contract for Codex and RocketRide. | Stream names, offsets, event counts, replay command/output. |
| FalkorDB | Own F1-F5: idempotent `MERGE` writes, schema, F2/F3/F4 reads, per-task graph isolation. | Browser screenshot path, Cypher files, query output, graph names. |
| Guild.ai | Support G1/G2 by publishing stable event and context payload shapes. | Contract file path and sample payload consumed by Track 2. |
| RocketRide | Support R1/R2 with replay/query functions usable from pipeline nodes. | Function path, fixture path, and one successful local invocation. |

## Work Plan

- [ ] Create the session simulator that emits realistic dev events using the required event
      envelope: `session_id`, `task_id`, `event_type`, `timestamp`, `payload`.
- [ ] Publish at least 15 simulator events to LaserData stream L1: `dev.session.events`.
- [ ] Implement replay-from-offset for L1 and save command output for the execution log.
- [ ] Create the FalkorDB schema files and use only `MERGE` for replay-safe writes.
- [ ] Build the L1-to-FalkorDB consumer and mirror every graph write to LaserData stream L2:
      `relay.graph.mutations`.
- [ ] Implement F2 context reconstruction: Task -> Steps -> Decisions.
- [ ] Implement F3 blocker/dependency lookup.
- [ ] Implement F4 similar blocker/decision lookup using available vector support or a documented
      fallback fixture if vector support is blocked.
- [ ] Confirm F5 with two active task graphs at the same time.
- [ ] Package sample payloads for Track 2 and Track 3 in a stable fixture location.

## Handoff Contract

Before asking Track 2 or Track 3 to integrate, provide:

- LaserData stream names, auth env vars, and a replay command.
- A JSON fixture with at least 15 L1 events.
- FalkorDB graph names, connection env vars, and Cypher query files for F2/F3/F4.
- A short note listing any blocked sponsor SDK calls and the fallback used.

## Task Log

| # | Time | Action | Sponsors | Evidence | Status |
|---|---|---|---|---|---|
| 1 | 2026-08-03 11:19 PDT | Track created and assigned to Claude Code #1. | LaserData, FalkorDB, Guild.ai, RocketRide | `execution/CLAUDECODE_1_CAPTURE_MEMORY.md` | ready |
| | | | | | |

## Change Discipline

Every code or doc change must update `CHANGELOG.md`. Every completed runtime sponsor touchpoint
must update `EXECUTION.md` Section 4 with real evidence, not a placeholder.
