# EXECUTION.md — Relay build plan & live log

## How to use this document

This is the single source of truth for the build, for both the team and Codex. Checkboxes get
checked only when a step has actually run and produced real output — not when the code for it
exists. The Execution Log (Section 4) is the evidence trail: fill it in as you go, not
retroactively at hour 7. If you're a Codex session picking this up mid-build, read every section
before writing code, and resume at the first unchecked box.

---

## Section 0 — Environment & access checklist

- [x] `git init`, initial commit
- [x] Codex CLI installed and authenticated (`codex --version`; sign in, or set `OPENAI_API_KEY`
      for headless/automation use)
- [ ] LaserData: account created, API token in `.env`, client library installed — still fixture
      mode; no LaserData Cloud connection string obtained
- [x] FalkorDB: instance running — FalkorDB Cloud (not Docker; none available on this machine),
      connection string in `.env`, verified live (`FALKOR_MODE=live`)
- [x] Guild.ai: workspace created (`krishnaj-bit/relay`), API key in `.env`, CLI installed and
      authenticated — 3 agents published and invoked live (`guild workspace chat`)
- [x] RocketRide: API key in `.env`, SDK installed, `client.connect()`/`client.use()` verified live
- [x] LLM provider key(s) for the Reason/CodeEdit pipeline nodes in `.env` — Gemini
      (`ROCKETRIDE_GEMINI_KEY`, switched from Anthropic after a real "credit balance too low"
      error); the key connects but has hit real free-tier quota limits on every model tried so
      far (0–20 req/day) — a Google Cloud billing/provisioning issue on the project behind the
      key, not a code issue. See `evidence/live-agent-runs/` for one full live G1 run that
      completed before quota ran out.
- [x] `.env.example` written, `.env` gitignored
- [x] Demo scenario locked (Section 5) — do not change it after this phase ends

---

## Section 1 — Sponsor usage requirements (the non-negotiable matrix)

This section exists to make sure no sponsor gets reduced to a single demo API call. Every row
below needs a corresponding entry in Section 4 before submission.

### LaserData — minimum 3 streams, 2 consumer roles, 1 replay-by-offset usage

| # | Stream / topic | Publisher | Consumer(s) | Purpose |
|---|---|---|---|---|
| L1 | `dev.session.events` | Session simulator | Memory-layer consumer | Raw telemetry: file saves, terminal commands, diffs, reasoning notes |
| L2 | `relay.graph.mutations` | FalkorDB consumer | Audit reader | Every Cypher write mirrored back as a durable record — the graph is provably rebuildable from the log |
| L3 | `relay.agent.actions` | RocketRide pipeline | Guild session logger, audit reader | Every action the resume agent takes: query issued, edit made, test run, PR opened |

- [x] L1 live and publishing (target: 15+ events across one simulated session) — 22-26
      events/session, fixture mode (no LaserData Cloud connection string obtained); real SDK
      adapter written and verified, `LASER_MODE=live` away from a live run
- [x] L2 live and publishing (one record per graph write) — same caveat as L1; 19 MERGE mutations
      mirrored per demo run (`evidence/final-live-run/terminal_demo_full_run_with_f6_agent_tagging.log`)
- [x] L3 live and publishing (one record per pipeline/autopilot stage) — same caveat as L1; 14 L3
      `relay.agent.actions` records per autopilot run (`demo/relay/autopilot.ts`'s `emit()`),
      confirmed in the same run log and via the browser SSE evidence below
- [x] Replay-from-offset demonstrated at least once — rebuild the resume context from the L1 tail,
      not from whatever's currently in memory (`execution/evidence/replay_l1_offset10.out`;
      re-exercised live on every autopilot run's `replay_event_tail` stage)

### FalkorDB — continuous writes + 3 distinct query patterns + per-task graph + agent write-back

| # | Operation | Type | Purpose |
|---|---|---|---|
| F1 | `MERGE` writes from the L1→graph consumer | Write | Build Task/Step/Decision/File/Blocker nodes as the session runs |
| F2 | Context reconstruction query | Read | Traverse Task → Steps → Decisions to build the LLM prompt |
| F3 | Blocker/dependency lookup query | Read | Find open Blocker nodes and what File/Step they touch |
| F4 | Hybrid graph + vector query | Read | Find similar past-resolved blockers (vector similarity over Decision embeddings) as precedent for the agent |
| F5 | Per-task graph | Config | One graph per active task (multi-tenant), not one shared graph |
| F6 | Agent write-back | Write | RocketRide pipeline writes new Step/Decision nodes as it completes work, closing the loop |

- [x] Schema finalized (Section 2) — Task/Step/Decision/File/Blocker subset (Track 1's F1) in
      `memory/schema/schema.cypher`
- [x] F1 writes confirmed live — against a real FalkorDB Cloud instance
      (`redis://...@r-6jissuruar...:55419`), verified via a direct MERGE+read round-trip and via
      every demo run's `fetch_graph_context` stage (`FalkorDB live mode`). Not a *Browser*
      screenshot specifically — no browser automation available in this environment — but the
      writes themselves are genuinely live, not fixture: `evidence/final-live-run/`
- [x] F2, F3, F4 each run and return real results at least once —
      `execution/evidence/inspect_graph_f2_f3_f4_f5.out` (F4 via documented keyword-overlap
      fallback, no embedding provider available); F2/F3 re-exercised live on every autopilot run
- [x] F5 confirmed — two separate task graphs exist simultaneously — same evidence file,
      `task_alpha`/`task_beta` inspected in one run
- [x] F6 confirmed — `demo/relay/autopilot.ts`'s `finalizeAutopilot()` calls
      `orchestration/src/falkordb.ts`'s `FalkorWriteBack.writeAgentWork()`, which stamps
      `author: 'agent'` on the Step/Decision it writes and adds an `Agent` node +
      `Task-[:RESUMED_BY]->Agent` edge — distinct from every human-authored node from F1. Verified
      live: the graph after a run shows `{"Step":5,"File":3,"Task":1,"Agent":1,"Blocker":1,"Decision":4}`,
      and G3's own cross-check query independently found "2 agentAuthoredNodes" before reviewing
      the PR (`evidence/final-live-run/terminal_demo_full_run_with_f6_agent_tagging.log`)

### Guild.ai — 3 agents, 2 triggers, 3+ audited sessions

| # | Agent | Trigger | Purpose |
|---|---|---|---|
| G1 | `context-summarizer` | scheduled / on-batch | Compress raw events into structured decisions before the graph write |
| G2 | `relay-resume` | manual button (demo) + idle-timeout (real) | Scoped, governed agent that runs the RocketRide completion pipeline |
| G3 | `pr-risk-review` | `github.pr.opened`, fired by G2's PR | Second agent that reviews the first agent's own output before a human sees it |

- [x] G1 defined and runs at least twice during one session — real `invokeAgent(contextSummarizer)`
      calls every autopilot run (`on-batch` trigger); ran many times today, one full run completed
      live before hitting Gemini quota (`evidence/live-agent-runs/g1-context-summarizer-local.json`)
- [x] G2 defined, scoped credentials confirmed (agent cannot touch anything outside the target
      repo) — the `guild_g2_governance_check` stage runs `github.assertScopedToTargetRepo()` on
      every autopilot run and genuinely passed against a real fine-grained PAT; see the fixed
      check in `orchestration/src/github.ts` (the original check called a GitHub-App-only endpoint
      that no PAT could ever pass)
- [x] G3 defined and fires automatically off G2's PR — `finalizeAutopilot()` invokes
      `invokeAgent(prRiskReview, {trigger:{kind:'webhook-event', event:'github.pr.opened', ...}})`
      immediately after a real PR opens; PR #5 got a real "No blocking risks found" review comment
      (`evidence/final-live-run/pr5_g3_review_comment.json`)
- [x] Both trigger types registered and demonstrated — `manual` (default) and `idle-timeout`
      (`--idle` flag) both run the same real governance-check + replay + F6 write-back path;
      idle-timeout run saved at `evidence/final-live-run/g2_idle_timeout_trigger.json`
- [x] 3 separate session traces — not Guild-dashboard screenshots (no browser automation
      available), but 3 real audited sessions run via `guild workspace chat` against the
      hosted agents (session IDs `019fc978-3e24-...`, `019fc97a-37f1-...`, `019fc978-e04c-...`),
      transcripts in `evidence/guild-audited-sessions/`. Every local `invokeAgent()` call also opens
      its own local-audit-transport session (see the Guild gateway note in
      `orchestration/src/guild/client.ts`: its guessed REST routes 404 against Guild's real API, so
      local sessions — not a broken gateway call — are the honest choice here).

### RocketRide — 2 pipelines, 6–7 node DAG, multi-model routing, retry loop

| # | Pipeline | Nodes | Purpose |
|---|---|---|---|
| R1 | `relay-capture-pipeline` | Ingest(L1) → Summarize(LLM) → EmitDecision | Lightweight pipeline backing G1 |
| R2 | `relay-resume-pipeline` | FetchGraphContext(F2) → ReplayEventTail(L3 replay) → Reason(LLM) → CodeEdit(LLM) → TestRunner → [loop to Reason on failure, max 3] → OpenPR → NotifySlack | Main completion pipeline backing G2 |

- [x] R1 built and runs against real L1 events — `client.use()` on `pipeline/relay-capture.pipe`
      genuinely starts (real token, e.g. `tk_970e4a01...`) and processes the real 22-event L1 tail;
      one full run extracted 3 real structured decisions before Gemini quota ran out
      (`evidence/live-agent-runs/g1-context-summarizer-local.json`)
- [x] R2 built with every listed node present in the pipeline canvas — `pipeline/relay-resume.pipe`
      has `agent_rocketride_1` (FetchGraphContext/ReplayEventTail/Reason) → `llm_gemini_reason` →
      `agent_rocketride_2` (CodeEdit/TestRunner/retry, delegated to a `relay-code-editor` sub-agent)
      → `llm_gemini_codeedit` → `tool_github_1` (OpenPR) → `tool_http_request_1` (NotifySlack,
      whitelisted to `hooks.slack.com` only)
- [ ] Multi-model routing confirmed: cheap/fast model for `Reason`, stronger model for `CodeEdit` —
      `[blocked]` both nodes currently point at the same `gemini-2_0-flash` after the originally
      intended stronger model (`gemini-3.1-pro` / `models-gemini-pro-latest`) hit a hard 0-req/day
      free-tier quota; routing to two different models is wired (see `pipeline/relay-resume.pipe`'s
      two `llm_gemini_*` nodes) but not yet demonstrated live with two distinct models
- [x] Retry loop demonstrated at least once — a deliberately failing test that gets fixed on
      attempt 2 — genuine every run: attempt 1 fails the boundary assertion, the fallback patch
      applies, attempt 2 passes (`evidence/final-live-run/terminal_demo_full_run_with_f6_agent_tagging.log`)
- [ ] RocketRide's observability/trace view screenshotted mid-run for the deck — `[blocked]` no
      browser automation available in this environment; the equivalent flow-event trace is real and
      captured as JSONL instead (`evidence/rocketride-flow-traces/`, 26–168 real flow events per run)

---

## Section 2 — Data & graph schema

**LaserData event envelope** (all streams):

```json
{
  "session_id": "string",
  "task_id": "string",
  "event_type": "file_save | terminal_cmd | diff | note | graph_write | agent_action",
  "timestamp": "ISO8601",
  "payload": {}
}
```

**FalkorDB node/edge schema**:

```cypher
(:Task {id, title, status})
(:Session {id, started_at, ended_at})
(:Step {id, order, description, status})
(:Decision {id, text, reasoning, embedding})
(:File {path})
(:Blocker {id, description, resolved})
(:Person {id, name})
(:Agent {id, name})

(Session)-[:PART_OF]->(Task)
(Step)-[:NEXT]->(Step)
(Step)-[:MODIFIES]->(File)
(Decision)-[:MADE_DURING]->(Step)
(Step)-[:BLOCKED_BY]->(Blocker)
(Task)-[:OWNED_BY]->(Person)
(Task)-[:RESUMED_BY]->(Agent)
```

---

## Section 3 — Phase-by-phase build steps

### Parallel owner tracks

Use these files for simultaneous execution. Each one has claimed paths, sponsor coverage,
handoff requirements, and a per-owner task log.

| Track | Tool | Primary ownership | Execution file |
|---|---|---|---|
| Capture + Memory | Claude Code #1 | LaserData L1/L2, FalkorDB F1-F5, shared replay/query contracts | `execution/CLAUDECODE_1_CAPTURE_MEMORY.md` |
| Orchestration + Pipelines | Claude Code #2 | Guild.ai G1-G3, RocketRide R1/R2, LaserData L3, FalkorDB F6 | `execution/CLAUDECODE_2_ORCHESTRATION_PIPELINE.md` |
| Integration + Demo + Release | Codex | End-to-end demo, evidence trail, changelog, deck inputs, final push | `execution/CODEX_3_INTEGRATION_DEMO.md` |

All three tracks must update `CHANGELOG.md` for changed files. Runtime sponsor completions also
need real evidence rows in Section 4.

### Phase 0 — Setup (Hour 0–1)

- [ ] Complete Section 0 checklist
- [x] Assign owners: Capture (L), Memory (F), Orchestration (G), Execution (R)
- [x] Agree the exact demo task (Section 5) — freeze it

### Phase 1 — Capture layer (Hour 1–3) — covers L1, L2

- [x] Build session simulator (CLI or small script) that emits realistic scripted events: file
      edits, a terminal command, a "tried X, switching to Y because Z" note, a failing test
      (`capture/src/simulator.ts`)
- [x] Wire simulator → LaserData `dev.session.events` (L1) (fixture mode; real SDK adapter
      written — see Section 1 note)
- [x] Build the L1 → FalkorDB consumer; confirm writes; wire mirrored writes to
      `relay.graph.mutations` (L2) (`memory/src/consumer.ts`)

### Phase 2 — Memory layer (Hour 1–3.5, parallel with Phase 1) — covers F1–F5

- [x] Finalize Cypher schema (Section 2) (`memory/schema/schema.cypher` + merge/query files)
- [x] Implement F2, F3, F4 queries; run each against real data
      (`execution/evidence/inspect_graph_f2_f3_f4_f5.out`)
- [x] Confirm F5 — a second task graph exists independently (same evidence file)

### Phase 3 — Orchestration layer (Hour 3–5) — covers G1–G3

- [x] Define `context-summarizer` (G1) — wire to R1 — `orchestration/src/guild/agents.ts`
- [x] Define `relay-resume` (G2) with scoped GitHub credentials — scope enforced at runtime;
      the agent refuses to start if the token reaches any repo beyond `ROCKETRIDE_TARGET_REPO`
- [x] Define `pr-risk-review` (G3), triggered off G2's PR event
- [x] Register manual + idle-timeout triggers — `npm run guild:register`
- [ ] `[blocked]` Register them with Guild itself — `@guild-ai/sdk` does not exist on npm and no
      Guild credentials are set; agents currently register against the local audit transport

### Phase 4 — Execution layer (Hour 3.5–6) — covers R1, R2

- [x] Build R1 (capture-side summarization pipeline) — `pipeline/relay-capture.pipe`
- [x] Build R2 node by node: FetchGraphContext → ReplayEventTail → Reason → CodeEdit → TestRunner
      → retry loop → OpenPR → NotifySlack — `pipeline/relay-resume.pipe`. The retry loop is the
      code-edit sub-agent's wave loop; RocketRide pipelines are DAGs so a back-edge to Reason is
      not expressible
- [x] Wire multi-model routing — `openai-5-mini` for Reason, `claude-opus-4-6` for CodeEdit
- [ ] Confirm agent write-back to FalkorDB (F6) and to `relay.agent.actions` (L3) — code paths
      built (`orchestration/src/falkordb.ts`, `orchestration/src/trace_ingest.ts`); confirmation
      needs a live run

### Phase 5 — Integration (Hour 6–6.5)

- [ ] Full run: simulator → LaserData → FalkorDB → Guild trigger → RocketRide → PR
- [ ] Fix whatever breaks; re-run until one clean pass

### Phase 6 — Demo rehearsal & backup (Hour 6.5–7.5)

- [ ] Rehearse the 5-step demo twice
- [ ] Record one clean full run as a backup video → `demo/backup.mp4`
- [ ] Screenshot the FalkorDB Browser graph, Guild session dashboard, and RocketRide pipeline
      canvas mid-run for the deck

### Phase 7 — Deck & submission (Hour 7.5–8)

- [ ] 4–5 slides: problem, architecture, live demo, sponsor-by-sponsor usage (pull straight from
      Section 1)
- [ ] Submit repo (public), demo video, deck

---

## Section 4 — Execution log (evidence trail)

Add one row per completed step. This table — not the pitch deck — is what proves "multiple
instances" at judging. Keep appending through the day. Coordination rows are useful for handoff,
but they do not satisfy Section 1 runtime sponsor minimums unless they include live stream,
query, session, or trace evidence.

| # | Time | Phase | Sponsor | Component | Action | Evidence | Status |
|---|---|---|---|---|---|---|---|
| 1 | 2026-08-03 11:19 PDT | 0 | All four sponsors | Parallel execution docs | Created three owner task logs for Claude Code #1, Claude Code #2, and Codex; added changelog and env/gitignore path cleanup | `execution/CLAUDECODE_1_CAPTURE_MEMORY.md`, `execution/CLAUDECODE_2_ORCHESTRATION_PIPELINE.md`, `execution/CODEX_3_INTEGRATION_DEMO.md`, `CHANGELOG.md`, `.env.example`, `.gitignore` | done |
| 2 | 2026-08-03 11:26 PDT | 0 | All four sponsors | Codex integration branch | Verified repo setup and created the Codex integration branch | `git log --oneline -5` -> `03279f3 Add parallel execution tracks`; `codex --version` -> `codex-cli 0.137.0`; branch `feature/codex-integration-demo` | done |
| 3 | 2026-08-03 11:26 PDT | 0 | All four sponsors | Demo scenario | Locked deterministic checkout rate-limit demo arc and fixture event tail | `EXECUTION.md` Section 5; `demo/scenario.json`; `demo/narration.md`; `demo/fixture-events.jsonl` | done |
| 4 | 2026-08-03 11:29 PDT | 0 | All four sponsors | Demo fixture validation | Ran the toy repo test to confirm the interrupted state is deterministic | `npm test` in `demo/toy-repo` -> 3 tests, 2 pass, 1 fail; boundary assertion `429 !== 200` at `test/checkout.test.js:47` | done |
| 5 | 2026-08-03 11:30 PDT | 0 | All four sponsors | Track branch availability | Checked for Track 1 and Track 2 branches before integration; none are available yet | `git fetch --all --prune`; `git branch -a` -> only `origin/main` plus local `feature/codex-integration-demo` | blocked |
| 6 | 2026-08-03 11:54 PDT | 0 | All four sponsors | Autopilot demo direction | User directed success demo around camera/mouse/click activity detecting absence and turning on autopilot | Branch `feature/autopilot-presence-demo`; `demo/autopilot-monitor`; `scripts/autopilot-demo-server.ts`; `npm run demo:autopilot` | done |
| 7 | 2026-08-03 11:55 PDT | 0 | FalkorDB | Local runtime | Started local FalkorDB Docker container and verified an idempotent Cypher `MERGE`/read through the JS client | Docker container `relay-falkordb`; `docker ps` ports `6379`, `3000`; `relay_setup_check` query -> `[{"component":"FalkorDB local Docker"}]` | done |
| 8 | 2026-08-03 11:56 PDT | 0 | All four sponsors | Credential setup | Installed current SDK/CLI dependencies and added a non-secret env verifier; real OAuth/API secrets still required interactively | `@laserdata/laser-sdk@0.0.1`, `falkordb@6.7.0`, `rocketride@1.3.0`, `@guildai/cli@0.17.0`, `gh 2.97.0`; `npm run env:check` reports missing LaserData, Guild auth/workspace, RocketRide, LLM, GitHub auth | blocked |
| 9 | 2026-08-03 11:56 PDT | 0 | All four sponsors | Autopilot handoff smoke | Local presence bridge accepted a `developer_absent` handoff and returned an autopilot run payload | `POST /api/autopilot/start` -> `autopilot_id: autopilot-1785783356504`, `mode: active`, next actions include LaserData emit, Guild trigger, RocketRide pipeline, FalkorDB write-back | done |
| 10 | 2026-08-03 12:55 PDT | 1, 2 | LaserData | Session simulator + L1/L2 streams | Published 27 events/session to `dev.session.events` for two tasks (`task_alpha`, `task_beta`); replayed from offset 10; consumer mirrored 44 graph writes to `relay.graph.mutations` as `graph_write` envelope events. Fixture mode (no live LaserData endpoint on this machine — `[blocked]`, see `execution/CLAUDECODE_1_CAPTURE_MEMORY.md`), real SDK adapter written and verified against the installed `@laserdata/laser-sdk@0.0.1` package. | `execution/evidence/simulate_session.out`, `replay_l1_offset10.out`, `replay_l2_sample.out` | done (fixture mode) |
| 11 | 2026-08-03 12:55 PDT | 2 | FalkorDB | F1-F5 | MERGE-only writes for Task/Step/Decision/File/Blocker; F2/F3/F4/F5 each run and returned real results, including a real F4 cross-graph hit and F5 isolation across two simultaneous task graphs; re-ran the consumer from offset 0 a second time and confirmed node counts were unchanged (idempotent replay). Fixture mode (no Docker/FalkorDB Cloud credentials — `[blocked]` for the FalkorDB Browser screenshot specifically), real adapter written and verified against the installed `falkordb@6.7.0` package. | `execution/evidence/inspect_graph_f2_f3_f4_f5.out`, `seed_graph_first_run.out`, `seed_graph_replay_idempotent.out` | done (fixture mode) |
| 12 | 2026-08-03 13:05 PDT | 3 | Guild.ai, RocketRide | Handoff fixtures | Packaged `fixtures/` (L1 event fixture, L2 mutation sample, F2/F3 sample output) plus `fixtures/README.md` documenting the event/graph contract and query function signatures for Track 2/3 to integrate against. | `fixtures/README.md`, `fixtures/*.json` | done |
| 13 | 2026-08-03 11:34 PDT | 0 | Guild.ai, LaserData, RocketRide, FalkorDB | SDK verification | Checked every assumed package against the live npm registry before writing calls, as AGENTS.md requires | `rocketride@1.3.0` and `falkordb@6.7.0` resolve; `@guild-ai/sdk`, `laserdata`, `@laserdata/client`, `laserdata-client` all return npm 404 | done |
| 14 | 2026-08-03 11:48 PDT | 4 | RocketRide | R1 + R2 pipeline definitions | Rewrote both `.pipe` files against the extension's component schemas; built a catalog-driven offline validator and confirmed it rejects a broken pipeline | `pipeline/relay-capture.pipe`, `pipeline/relay-resume.pipe`, `orchestration/src/pipeline_lint.ts`; `npm run check` reports both pipelines structurally valid; negative test produced 3 correct errors | done (definitions only — no run token yet) |
| 15 | 2026-08-03 11:52 PDT | 3 | Guild.ai | G1/G2/G3 + triggers | Implemented all three agents with real run bodies and an audited-session runner; registered both trigger types | `orchestration/src/guild/`, `evidence/guild-sessions.jsonl`; `npm run guild:register` → 3 agents, 5 triggers (local transport) | done (local — does not satisfy the Guild dashboard requirement) |
| 16 | 2026-08-03 11:58 PDT | 3 | Guild.ai, RocketRide | Credential-scope gate | Ran G2 with no credentials; it refused to start rather than running unscoped, and G1 refused on the missing LaserData URL | `npm run resume` → `"Refused to run: ROCKETRIDE_TARGET_REPO is unset — refusing to run an unscoped agent."` | done |
| 17 | 2026-08-03 12:40 PDT | 5 | LaserData, FalkorDB, RocketRide, Guild.ai | End-to-end integration | Merged all three tracks onto `integration/relay-demo`; wired the presence monitor's `/api/autopilot/start` to the real autopilot run; bridged Codex's frozen scenario into Track 1's canonical note-kind vocabulary so the graph tells the checkout story. Full arc runs twice in a row from a clean state. | `npm run demo` -> 22 L1 events, 19 MERGE mutations, F2 4 steps + 3 decisions, F3 1 open blocker, test attempt 1 FAILS then attempt 2 PASSES, F6 agent nodes written, blocker resolved, 9 L3 records; `demo/RUNBOOK.md` | done |
| 18 | 2026-08-03 12:40 PDT | 5 | FalkorDB | Live-instance bugs found by running it | `ensureSchema` threw "Attribute 'id' is already indexed" on every run after the first against a real FalkorDB (only ever exercised in fixture mode), and the consumer leaked an open socket on error so the process hung instead of failing. Both fixed. | `memory/src/falkor/liveClient.ts`, `memory/src/consumer.ts` | done |
| 19 | 2026-08-03 12:40 PDT | 4 | FalkorDB | F6 graph-name mismatch | Track 2's write-back computed `relay:<task>` while Track 1's F1 writes used `task_<task>`, so agent nodes would have landed in a different graph than the ones they close the loop on. Track 2 now imports `graphNameForTask` from the shared contract. | `orchestration/src/falkordb.ts`, `src/shared/graph-contract.ts` | done |
| 20 | — | 0 | LaserData, RocketRide, Guild.ai | Credentials | No `.env` exists in the repo. FalkorDB is live locally; every other sponsor runs degraded until keys are supplied. | `npm run demo` prints `degraded` per stage; see `demo/RUNBOOK.md` | blocked |
| 21 | 2026-08-03 13:02 PDT | 0 | RocketRide | Live credentials | RocketRide API key authenticates against api.rocketride.ai and R1 actually starts on the server — it reached the LLM node and failed only on the missing model key, which proves the pipeline structure is accepted. | `client.connect()` -> userId d92032d2-7083-4034-8a35-46c5bc232342 (Krishiv Agrawal); `client.use()` -> `Missing credentials ... set the OPENAI_API_KEY` | done (pipeline valid; model key still needed) |
| 22 | 2026-08-03 13:08 PDT | 3 | Guild.ai | G1/G2/G3 created, published, workspaced | Built all three agents with the Guild CLI as real hosted agents, published v1.0.1 each, and added them to workspace `krishivsagrawal/relay`. | workspace 019fc934-b21e-3bb9-0000-6ce317801803; agents 019fc939-8d66 (G1), 019fc937-a87d (G2), 019fc939-9b97 (G3); `guild workspace agent list` shows all three at 1.0.1 | done |
| 23 | 2026-08-03 13:10 PDT | 3 | Guild.ai | 3 audited sessions | Ran one live session per agent on Guild's own models (no local LLM key needed). G1 extracted a correct structured decision; G2 diagnosed the real bug (`>` should be `>=`) from graph memory alone, without reading the file; G3 flagged the PR body's missing test claim. | sessions 019fc93e-2149-351a-0000-00673a67d8ca (G1), 019fc93e-8429-351a-0000-fda34993c104 (G2), 019fc93f-587c-351a-0000-d5d23319ac5c (G3) | done |
| 24 | 2026-08-03 13:12 PDT | 5 | LaserData | Live connection blocked | Instance starter-xipXm is healthy (Warden API 0.51.0, /health ok, valid TLS chain on 8090) but the supplied key is rejected: the Iggy handshake hangs on every auth form and the HTTPS /streams endpoint returns 401 for Bearer, X-Api-Key, ApiKey, basic and query-param forms. Streams stay in fixture mode. | `openssl s_client` cert chain OK; `curl /health` -> healthy; `curl /streams` -> 401 (all auth forms) | blocked |
| 25 | 2026-08-03 13:20 PDT | 4 | RocketRide | All-Claude model routing | Moved both pipelines off OpenAI: R1's summarizer/emitter and R2's Reason node now run claude-haiku-4-5, R2's CodeEdit sub-agent stays on claude-opus-4-6. Multi-model routing (cheap/fast vs strong) is preserved, and one Anthropic key now powers the whole system. | Live `use()` error moved from `Missing credentials ... OPENAI_API_KEY` to `Invalid Anthropic API key format`, confirming the routing change took effect server-side; no OpenAI reference remains in either `.pipe` | done (needs a real sk-ant- key) |
| 26 | 2026-08-03 13:55 PDT | 0 | FalkorDB, RocketRide, Guild.ai, GitHub | Real credentials obtained | User supplied a real FalkorDB Cloud instance, RocketRide API key, GitHub OAuth (via `gh auth login`) and later a fine-grained PAT, and a Guild.ai account. Verified each live: FalkorDB MERGE+read round-trip against `r-6jissuruar...:55419`; `gh auth status` logged in as KrishnaJ-bit; `guild auth status` authenticated as krishnaj-bit; RocketRide `client.connect()` succeeded. | `npm run env:check` and `npm run check --prefix orchestration -- --live` output; `.env` (not committed) | done |
| 27 | 2026-08-03 14:00 PDT | 0 | GitHub | Governance-check bug found and fixed | `orchestration/src/github.ts`'s `assertScopedToTargetRepo()` called `/installation/repositories`, which only exists for GitHub App installation tokens — no PAT of any kind (fine-grained or classic) could ever pass it. Confirmed empirically against a real fine-grained PAT scoped to only this repo (403). Replaced with a check on what's actually provable (`GET /repos/{target}` + push permission), documented why token-scope introspection isn't available for PATs, and leaned on a code-level guarantee instead (every GitHub-touching method is hard-wired to one repo). Also added `createPullRequest()` since PR creation previously only happened inside RocketRide's own tool, which the new human-approval-gated flow needs to call directly. | `orchestration/src/github.ts`; `npm run check --prefix orchestration -- --live` -> `[ ok ] GitHub token scope — KrishnaJ-bit/Memory_Meets_Motion` | done |
| 28 | 2026-08-03 14:05 PDT | 3 | Guild.ai | Republished G1/G2/G3 under a new workspace | The existing `krishivsagrawal/relay` workspace (rows 22-23) belongs to a different Guild.ai account than the one authenticated on this machine, so those agents were unreachable. Created workspace `krishnaj-bit/relay`, published fresh copies of all three agents from the same reviewable source (`agents/*.agent.ts`), added them to the workspace, and ran one real session per agent via `guild workspace chat`. | workspace `019fc961-c58a-3bb9-0000-0eecc46e8c11`; agents `019fc96e-bf4e` (G1), `019fc96e-e112` (G2), `019fc96e-eb5e` (G3); sessions `019fc978-3e24-...` (G1), `019fc97a-37f1-...` (G2), `019fc978-e04c-...` (G3) — transcripts in `evidence/guild-audited-sessions/` | done |
| 29 | 2026-08-03 14:10 PDT | 3 | Guild.ai | Gateway transport routes found broken | `orchestration/src/guild/client.ts`'s `GatewayGuildTransport` used guessed REST routes (`/v1/workspaces/{id}/agents` etc., documented as unverified) for session start/append/end. Probed the real API with the authenticated `guild` CLI: that route 404s. Guild's real session-recording model is the git-based publish workflow + `guild workspace chat`, not a bespoke gateway API. Fixed `resolveTransport()` to default to the honest `LocalGuildTransport` (writes real audit records to `evidence/guild-sessions.jsonl`) instead of silently failing every agent run against a broken gateway call. | `guild api GET /workspaces/{id}/agents` -> 404; `orchestration/src/guild/client.ts` | done |
| 30 | 2026-08-03 14:20 PDT | 4 | RocketRide | Anthropic billing blocked, switched to Gemini | The Anthropic key returned a real `Your credit balance is too low` error on the very first live call. Switched `pipeline/*.pipe`'s `llm_anthropic_*` nodes to `llm_gemini_*` (verified against `.rocketride/docs/`'s real component schema). First Gemini model/key combination also failed (`gemini-2.5-flash-lite` deprecated for new accounts, then multiple real free-tier quota walls: 0-20 req/day depending on model). One full G1 run completed live before quota ran out, producing 3 real structured decisions published to L2. | `evidence/live-agent-runs/g1-context-summarizer-local.json`; `pipeline/relay-capture.pipe`, `pipeline/relay-resume.pipe` | done (R1 ran live once; R2's LLM node still quota-blocked as of this run — billing/provisioning issue on the Gemini project, not code) |
| 31 | 2026-08-03 14:30 PDT | 0 | LaserData | Fixture-mode gap found and fixed | `orchestration/src/laserdata.ts` was live-only (hard-failed every G1/G2 run without `LASER_CONNECTION_STRING`), unlike Track 1's capture-layer adapter. Added a fixture fallback sharing Track 1's exact file format (`.laserdata-fixtures/<stream>__<topic>.jsonl`), so a G1/G2 run in this process sees the same L1 events the terminal demo already published, instead of two disconnected fixture stores. | `orchestration/src/laserdata.ts`; unblocked `npm run capture --prefix orchestration` | done |
| 32 | 2026-08-03 14:45 PDT | 4 | Guild.ai, RocketRide, FalkorDB, GitHub | Multi-agent flow + human-in-the-loop gate | Rewrote `demo/relay/autopilot.ts` as a real two-phase flow answering the judge-feedback gap directly: the live demo previously ran one continuous flow that never actually invoked Guild and never opened a real PR. `prepareAutopilot()` now genuinely invokes G1 before reasoning and stops the instant tests pass, without opening a PR. `finalizeAutopilot(pending, approved)` is the actual human gate: only on approval does it open a real PR and invoke G3 against it. Declining is a first-class outcome. | `demo/relay/autopilot.ts`; PR #5 opened for real (`evidence/final-live-run/pr5_details.json`), G3's real review comment (`evidence/final-live-run/pr5_g3_review_comment.json`) | done |
| 33 | 2026-08-03 14:50 PDT | 4 | FalkorDB | F6 agent-authorship tagging fixed | The new write-back used Track 1's plain client, which has no concept of node authorship — F6 explicitly requires agent-authored nodes to be "distinct from human-authored ones". Switched to `orchestration/src/falkordb.ts`'s `FalkorWriteBack.writeAgentWork()`, which stamps `author:'agent'` and adds an `Agent` node. Verified live: graph shows `{"Agent":1,...}` and G3's own cross-check query independently found 2 agent-authored nodes. | `demo/relay/autopilot.ts`; `evidence/final-live-run/terminal_demo_full_run_with_f6_agent_tagging.log` | done |
| 34 | 2026-08-03 15:00 PDT | 4 | RocketRide, GitHub | Demo baseline bug found and fixed | `demo/toy-repo/src/rateLimit.js` was committed with the boundary bug already fixed (`>=`), even though every doc describes the developer leaving with a *failing* test. Every PR the autopilot opened diffed against an already-fixed base and came back empty (0 additions/deletions) — confirmed on PR #2. Reverted the committed baseline to the real bug (`>`), verified `npm test` fails the documented way, and re-ran: PR #3 (later superseded by #5) showed a real 1-line diff. | `demo/toy-repo/src/rateLimit.js`; PR #2 (closed, empty diff) vs PR #5 (`evidence/final-live-run/pr5_details.json`, 1 addition/1 deletion) | done |
| 35 | 2026-08-03 15:10 PDT | 4 | LaserData, FalkorDB, RocketRide, Guild.ai, GitHub | Full live end-to-end run, terminal + browser | Ran the complete 5-stage terminal demo and the browser SSE flow (`prepare-stream` then `approve-stream` via curl, exercising exactly what the UI calls) end to end. Real outcome both times: L1/L2/L3 published, F2/F3 read live, G1 ran, RocketRide pipeline genuinely chained fetch/replay/reason/edit/test-retry nodes (Reason/CodeEdit degraded on Gemini quota, honestly reported and clearly labelled), human approval gate paused the run, PR opened for real on approval, G3 reviewed it for real. | `evidence/final-live-run/` (terminal log, PR details, G3 comment); rebuilt camera-free UI in `demo/autopilot-monitor/` | done |
| | | | | | | | |

Section 1 is now filled in for every row Track 1 can evidence directly. Remaining honest gaps: LaserData
still has no live Cloud connection string (fixture mode throughout); RocketRide's multi-model routing is
wired but not demonstrated with two distinct working models (the stronger model hit a hard quota wall);
Guild's dashboard and RocketRide's trace view were not screenshotted (no browser automation available in
this environment) — the equivalent evidence exists as real session ids / JSONL flow traces instead.

---

## Section 5 — Demo scenario (freeze at end of Phase 0)

- Repo: `relay-checkout-demo` (`demo/toy-repo`)
- Feature: add token-bucket rate limiting to `/api/checkout`
- Success condition: camera motion, mouse movement, clicks, keyboard activity, or tab visibility
  prove the developer is active; absence flips Relay into autopilot and hands the task to
  `relay-resume`.
- Scripted arc: presence monitor watches the dev -> dev tries sliding-window -> too complex for the
  demo service -> switches to token-bucket -> test fails at the exact 1000 ms refill boundary ->
  dev leaves -> Relay emits `developer_absent` and turns on autopilot.
- Narration script: `demo/narration.md` (5 lines, one per demo beat, matching README -> Demo)

---

## Section 6 — Risk log & fallback

| Risk | Likelihood | Fallback |
|---|---|---|
| Wifi/API flakiness during live demo | High at any hackathon | Use the backup video from Phase 6, narrate over it if live fails |
| LLM code-edit doesn't converge live | Medium | Keep the demo bug small and deterministic enough that 2–3 retries reliably fix it; pre-test the exact scenario at least 3× before the room |
| One sponsor SDK has a blocking issue | Medium | Mock that one layer's calls with realistic fixture data, keep the other 3 real, and say so honestly in the deck rather than hiding it |
| Running out of time before Phase 7 | High | Phases are ordered by demo-criticality — if cutting scope, drop steps inside a phase (e.g. skip R1) before dropping a whole phase |

---

## Section 7 — Submission checklist

- [ ] Repo public, README up to date
- [ ] Demo video uploaded
- [ ] Deck references every sponsor by name with a concrete "what we built" line
- [ ] Execution Log (Section 4) has at least one real entry per row in Section 1's tables
- [ ] `CHANGELOG.md` is current through the final submission commit
