# Claude Code Track 2 - Orchestration + Pipelines

Owner tool: Claude Code #2

Mission: build the governed agent layer and RocketRide pipelines that turn Relay's memory graph
into a scoped, auditable task-completion run.

## Start Here

1. Read `AGENTS.md`, `EXECUTION.md`, `CHANGELOG.md`, and this file before editing.
2. Work on branch `feature/claudecode-orchestration-pipeline`.
3. Confirm current Guild.ai and RocketRide SDK/client commands from live docs or `--help` before
   writing integration code.
4. Coordinate any shared event or graph contract change with Track 1 before committing.
5. Update the task log below after every meaningful step.
6. Update `CHANGELOG.md` for every committed change.
7. Add real evidence to `EXECUTION.md` Section 4 for each completed sponsor touchpoint.

## Claimed Paths

Primary paths:

- `orchestration/`
- `pipeline/`
- `agents/`, if Guild agent definitions are kept separately from orchestration helpers
- `src/shared/` pipeline or agent contract files, if a shared TypeScript package is added
- `execution/CLAUDECODE_2_ORCHESTRATION_PIPELINE.md`

Avoid editing unless coordinated:

- `capture/`
- `memory/`
- `demo/`
- `README.md`, `EXECUTION.md`, and `CHANGELOG.md` outside required log/changelog rows

## Sponsor Coverage

| Sponsor | Owned or supported work | Required evidence |
|---|---|---|
| LaserData | Own L3 `relay.agent.actions`; consume L1 replay contract from Track 1 inside R2. | Stream offsets, action event payloads, replay use in pipeline trace. |
| FalkorDB | Use F2/F3/F4 reads from Track 1; own F6 agent write-back from RocketRide to graph. | Query output, write-back Cypher result, agent-authored nodes in graph. |
| Guild.ai | Own G1 `context-summarizer`, G2 `relay-resume`, G3 `pr-risk-review`, manual trigger, idle-timeout trigger, and audited sessions. | Guild session IDs, trigger IDs, dashboard screenshot path. |
| RocketRide | Own R1 and R2 pipeline definitions, multi-model routing, retry loop, PR/Slack terminal nodes. | Pipeline file paths, run/trace IDs, retry evidence, canvas screenshot path. |

## Work Plan

- [ ] Define G1 `context-summarizer` and wire it to R1.
- [ ] Define G2 `relay-resume` with scoped repo/GitHub credentials and no broader filesystem
      access than the target repo.
- [ ] Define G3 `pr-risk-review` and trigger it from the PR opened by G2.
- [ ] Register and demonstrate both trigger types: manual button and idle-timeout.
- [ ] Build R1 `relay-capture-pipeline`: Ingest(L1) -> Summarize(LLM) -> EmitDecision.
- [ ] Build R2 `relay-resume-pipeline`: FetchGraphContext -> ReplayEventTail -> Reason ->
      CodeEdit -> TestRunner -> retry loop -> OpenPR -> NotifySlack.
- [ ] Wire multi-model routing: cheap/fast model for `Reason`, stronger model for `CodeEdit`.
- [ ] Emit every pipeline node action to LaserData L3: `relay.agent.actions`.
- [ ] Write agent-authored Step/Decision nodes back to FalkorDB for F6.
- [ ] Capture at least three audited Guild session traces.
- [ ] Capture at least one RocketRide trace where a failing test succeeds on retry.

## Handoff Contract

Before asking Track 3 to run the end-to-end demo, provide:

- Guild agent definition paths, trigger IDs, and session IDs.
- RocketRide pipeline definition paths and run/trace IDs.
- L3 stream names, offsets, and sample action payloads.
- Evidence that R2 consumed Track 1's graph/replay outputs and wrote F6 back to FalkorDB.

## Task Log

| # | Time | Action | Sponsors | Evidence | Status |
|---|---|---|---|---|---|
| 1 | 2026-08-03 11:19 PDT | Track created and assigned to Claude Code #2. | LaserData, FalkorDB, Guild.ai, RocketRide | `execution/CLAUDECODE_2_ORCHESTRATION_PIPELINE.md` | ready |
| | | | | | |

## Change Discipline

Every code or doc change must update `CHANGELOG.md`. Every completed runtime sponsor touchpoint
must update `EXECUTION.md` Section 4 with real evidence, not a placeholder.
