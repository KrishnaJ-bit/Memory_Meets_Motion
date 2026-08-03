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

Boxes are checked only when the step has produced real output. "Built" below means the code
exists and passes offline validation; the runtime boxes stay open until credentials exist.

- [x] Define G1 `context-summarizer` and wire it to R1. — `orchestration/src/guild/agents.ts`
- [x] Define G2 `relay-resume` with scoped repo/GitHub credentials and no broader filesystem
      access than the target repo. — scope declared in `agents.ts`, enforced at runtime by
      `github.assertScopedToTargetRepo()`; the agent refuses to start if the token can reach
      any repo other than `ROCKETRIDE_TARGET_REPO`, or if its scope cannot be proven.
- [x] Define G3 `pr-risk-review` and trigger it from the PR opened by G2.
- [x] Register both trigger types (manual button + idle-timeout). — `npm run guild:register`
- [ ] Demonstrate both trigger types against Guild itself. `[blocked]` no Guild credentials;
      also see the SDK note below.
- [x] Build R1 `relay-capture-pipeline`: Ingest(L1) -> Summarize(LLM) -> EmitDecision.
- [x] Build R2 `relay-resume-pipeline`: FetchGraphContext -> ReplayEventTail -> Reason ->
      CodeEdit -> TestRunner -> retry loop -> OpenPR -> NotifySlack.
- [x] Wire multi-model routing: `openai-5-mini` for `Reason`, `claude-opus-4-6` for `CodeEdit`.
- [x] Emit every pipeline node action to LaserData L3: `relay.agent.actions`. —
      `orchestration/src/trace_ingest.ts` converts each `apaevt_flow` component trace into one
      L3 record. Runs must start with `pipelineTraceLevel: 'summary'` or no traces fire.
- [x] Write agent-authored Step/Decision nodes back to FalkorDB for F6. — two paths:
      `tool_falkordb_2` inside R2 (write-enabled) and `orchestration/src/falkordb.ts` for the
      case where the pipeline aborts mid-wave. MERGE only, `author: 'agent'` on every node.
- [ ] Capture at least three audited Guild session traces. `[blocked]` needs Guild credentials.
- [ ] Capture at least one RocketRide trace where a failing test succeeds on retry.
      `[blocked]` needs a RocketRide API key and the frozen demo repo (Section 5 is still
      unfilled).

## SDK Verification (2026-08-03)

Per AGENTS.md, package names were checked against the live npm registry before any call was
written:

| Sponsor | AGENTS.md assumed | Registry result | What Track 2 does |
|---|---|---|---|
| RocketRide | TS SDK | `rocketride@1.3.0` exists | Installed; calls written against its actual `.d.ts` |
| FalkorDB | official driver | `falkordb@6.7.0` exists | Installed; used for F6 write-back |
| LaserData | typed Node client | **`@laserdata/laser-sdk@0.0.1` exists** | Installed; used for L1 replay and L2/L3 publish |
| Guild.ai | `@guild-ai/sdk` | **404.** Real SDK is `@guildai/agents-sdk`, **private** | Agents defined against a local contract; `GuildTransport` is the swap-in seam. Route names in `guild/client.ts` → `ROUTES` remain unverified |

**Correction (2026-08-03 12:04 PDT).** My first pass reported "no LaserData client package
found" and hand-rolled an HTTP client. That was wrong: I tested `laserdata`,
`@laserdata/client` and `laserdata-client`, but not the `@laserdata` scope. Codex's branch
`feature/autopilot-presence-demo` had the right name. Two consequences, both now fixed:

1. `orchestration/src/laserdata.ts` uses the real SDK, configured by `LASER_CONNECTION_STRING`
   and `LASER_STREAM` (the variables `Laser.connectEnv()` actually reads).
2. **LaserData is Iggy over TCP, not HTTP** — so the `tool_http_request` nodes I had given the
   agents for L1 replay and L2/L3 publishing could never have worked. Those nodes are removed.
   The replay now runs in G2 via the SDK and is handed to R2 as `event_tail` question context;
   R1 returns decisions as its answer and G1 publishes them to L2; L3 continues to come from
   the trace ingester. The one surviving HTTP tool is Slack.

Guild is still genuinely blocked: its SDK is private and needs `guild auth login` to configure
npm access, and the CLI is not installed on this machine.

## Design Note: the retry loop is not a graph cycle

RocketRide pipelines are DAGs — `TestRunner -> Reason` cannot be expressed as an edge. The
retry loop is the code-edit sub-agent's wave loop: it runs the tests, revises, and re-runs, and
the parent re-delegates on failure, capped at three attempts. Every attempt still surfaces as
separate `apaevt_flow` events, so the retry is visible in the trace.

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
| 2 | 2026-08-03 11:34 PDT | Verified sponsor SDK package names against the live npm registry before writing calls. `rocketride@1.3.0` and `falkordb@6.7.0` exist; `@guild-ai/sdk` and every LaserData client spelling return 404. | Guild.ai, LaserData, RocketRide, FalkorDB | npm registry 404s for `@guild-ai/sdk`, `laserdata`, `@laserdata/client`, `laserdata-client`; `npm view rocketride version` → 1.3.0; `npm view falkordb version` → 6.7.0 | done |
| 3 | 2026-08-03 11:41 PDT | Rewrote R1/R2 against the extension's real component schemas. Previous drafts used providers that do not exist as lane nodes (`tool_python`, `tool_github` are control-plane tools) and non-substitutable env vars. | RocketRide | `pipeline/relay-capture.pipe`, `pipeline/relay-resume.pipe` | done |
| 4 | 2026-08-03 11:48 PDT | Built the offline `.pipe` validator (catalog-driven: lanes, `invoke` min/max, source config, GUID, field order) and confirmed it rejects a deliberately broken copy of R2 with 3 correct errors. | RocketRide | `orchestration/src/pipeline_lint.ts`; negative test flagged lane mismatch, unknown provider, and missing memory connection | done |
| 5 | 2026-08-03 11:52 PDT | Implemented G1/G2/G3 with real run bodies, the audited-session runner, and both trigger registrations. `npm run guild:register` printed 3 agents / 5 triggers via the local transport. | Guild.ai | `orchestration/src/guild/`, `evidence/guild-sessions.jsonl` | done (local transport — not Guild-side evidence) |
| 6 | 2026-08-03 11:55 PDT | Implemented L3 emission from RocketRide `apaevt_flow` traces and the FalkorDB F6 write-back (MERGE-only, `author: 'agent'`). | LaserData, FalkorDB | `orchestration/src/trace_ingest.ts`, `orchestration/src/falkordb.ts` | done (code path; no live run yet) |
| 7 | 2026-08-03 11:58 PDT | Ran the setup checker and both agent entry points with no credentials. Pipelines pass structural validation; G2 refused to start on the credential-scope gate and G1 refused on the missing stream URL — both failed closed with accurate reasons. | RocketRide, Guild.ai | `npm run check` → 2 pipelines ok, 5 credential checks failed; `npm run resume` → "Refused to run: ROCKETRIDE_TARGET_REPO is unset" | done |
| 8 | 2026-08-03 12:04 PDT | Corrected the LaserData integration after Codex's branch surfaced the real package. Replaced the hand-rolled HTTP client with `@laserdata/laser-sdk`, and removed the LaserData HTTP tool nodes from both pipelines — the transport is Iggy over TCP, so those nodes could not have worked. Replay moved into G2, L2 decision writes into G1. | LaserData, RocketRide | `orchestration/src/laserdata.ts`, `pipeline/*.pipe`; `tsc` clean, both pipelines still pass the catalog validator | done |
| 9 | 2026-08-03 12:06 PDT | Adopted the demo scenario Codex froze: target repo, task id, and the concrete `npm test --prefix demo/toy-repo` command are now in `.env.example` and the R2 code-editor instructions instead of placeholders. | RocketRide | `demo/scenario.json` (Codex), `.env.example`, `pipeline/relay-resume.pipe` | done |
| 10 | — | Live sponsor runs (Guild sessions, RocketRide traces, L3 offsets, F6 nodes in the graph). | all four | — | blocked: no credentials in `.env`; Guild SDK is private and its CLI is not installed here |

## Change Discipline

Every code or doc change must update `CHANGELOG.md`. Every completed runtime sponsor touchpoint
must update `EXECUTION.md` Section 4 with real evidence, not a placeholder.
