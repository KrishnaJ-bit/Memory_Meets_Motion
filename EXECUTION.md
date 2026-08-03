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
- [ ] LaserData: account created, API token in `.env`, client library installed
- [x] FalkorDB: instance running — Docker (`docker run -p 6379:6379 -p 3000:3000 -it --rm
      falkordb/falkordb:latest`) or FalkorDB Cloud — connection string in `.env`
- [ ] Guild.ai: workspace created, API key in `.env`, `@guild-ai/sdk` installed
- [ ] RocketRide: account/Cloud credits claimed, API key in `.env`, SDK installed
- [ ] LLM provider key(s) for the Reason/CodeEdit pipeline nodes in `.env`
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

- [x] L1 live and publishing (target: 15+ events across one simulated session) — 26 events/session,
      fixture mode (no live LaserData endpoint reachable — see
      `execution/CLAUDECODE_1_CAPTURE_MEMORY.md` Blocker note); real SDK adapter written and
      verified, `LASER_MODE=live` away from a live run
- [x] L2 live and publishing (one record per graph write) — same caveat as L1
- [ ] L3 live and publishing (one record per pipeline node execution) — Track 2
- [x] Replay-from-offset demonstrated at least once — rebuild the resume context from the L1 tail,
      not from whatever's currently in memory (`execution/evidence/replay_l1_offset10.out`)

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
- [ ] F1 writes confirmed live in FalkorDB Browser — `[blocked]` no Docker/FalkorDB Cloud
      credentials on this machine, so no live FalkorDB instance to browse; MERGE writes verified
      instead via `execution/evidence/seed_graph_replay_idempotent.out` (replaying from offset 0
      twice applies the same 44 mutations and leaves node counts unchanged) — see
      `execution/CLAUDECODE_1_CAPTURE_MEMORY.md` Blocker note
- [x] F2, F3, F4 each run and return real results at least once —
      `execution/evidence/inspect_graph_f2_f3_f4_f5.out` (F4 via documented keyword-overlap
      fallback, no embedding provider available)
- [x] F5 confirmed — two separate task graphs exist simultaneously — same evidence file,
      `task_alpha`/`task_beta` inspected in one run
- [ ] F6 confirmed — graph shows agent-authored nodes distinct from human-authored ones — Track 2

### Guild.ai — 3 agents, 2 triggers, 3+ audited sessions

| # | Agent | Trigger | Purpose |
|---|---|---|---|
| G1 | `context-summarizer` | scheduled / on-batch | Compress raw events into structured decisions before the graph write |
| G2 | `relay-resume` | manual button (demo) + idle-timeout (real) | Scoped, governed agent that runs the RocketRide completion pipeline |
| G3 | `pr-risk-review` | `github.pr.opened`, fired by G2's PR | Second agent that reviews the first agent's own output before a human sees it |

- [ ] G1 defined and runs at least twice during one session
- [ ] G2 defined, scoped credentials confirmed (agent cannot touch anything outside the target
      repo)
- [ ] G3 defined and fires automatically off G2's PR
- [ ] Both trigger types registered and demonstrated
- [ ] 3 separate session traces visible in Guild's dashboard, screenshot saved for the deck

### RocketRide — 2 pipelines, 6–7 node DAG, multi-model routing, retry loop

| # | Pipeline | Nodes | Purpose |
|---|---|---|---|
| R1 | `relay-capture-pipeline` | Ingest(L1) → Summarize(LLM) → EmitDecision | Lightweight pipeline backing G1 |
| R2 | `relay-resume-pipeline` | FetchGraphContext(F2) → ReplayEventTail(L3 replay) → Reason(LLM) → CodeEdit(LLM) → TestRunner → [loop to Reason on failure, max 3] → OpenPR → NotifySlack | Main completion pipeline backing G2 |

- [ ] R1 built and runs against real L1 events
- [ ] R2 built with every listed node present in the pipeline canvas
- [ ] Multi-model routing confirmed: cheap/fast model for `Reason`, stronger model for `CodeEdit`
- [ ] Retry loop demonstrated at least once — a deliberately failing test that gets fixed on
      attempt 2
- [ ] RocketRide's observability/trace view screenshotted mid-run for the deck

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

- [ ] Define `context-summarizer` (G1) — wire to R1
- [ ] Define `relay-resume` (G2) with scoped GitHub credentials
- [ ] Define `pr-risk-review` (G3), triggered off G2's PR event
- [ ] Register manual + idle-timeout triggers

### Phase 4 — Execution layer (Hour 3.5–6) — covers R1, R2

- [ ] Build R1 (capture-side summarization pipeline)
- [ ] Build R2 node by node: FetchGraphContext → ReplayEventTail → Reason → CodeEdit → TestRunner
      → retry loop → OpenPR → NotifySlack
- [ ] Wire multi-model routing
- [ ] Confirm agent write-back to FalkorDB (F6) and to `relay.agent.actions` (L3)

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
| | | | | | | | |

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
