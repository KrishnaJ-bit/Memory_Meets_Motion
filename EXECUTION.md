# EXECUTION.md — Relay build plan & live log

## How to use this document

This is the single source of truth for the build, for both the team and Codex. Checkboxes get
checked only when a step has actually run and produced real output — not when the code for it
exists. The Execution Log (Section 4) is the evidence trail: fill it in as you go, not
retroactively at hour 7. If you're a Codex session picking this up mid-build, read every section
before writing code, and resume at the first unchecked box.

---

## Section 0 — Environment & access checklist

- [ ] `git init`, initial commit
- [ ] Codex CLI installed and authenticated (`codex --version`; sign in, or set `OPENAI_API_KEY`
      for headless/automation use)
- [ ] LaserData: account created, API token in `.env`, client library installed
- [ ] FalkorDB: instance running — Docker (`docker run -p 6379:6379 -p 3000:3000 -it --rm
      falkordb/falkordb:latest`) or FalkorDB Cloud — connection string in `.env`
- [ ] Guild.ai: workspace created, API key in `.env`, `@guild-ai/sdk` installed
- [ ] RocketRide: account/Cloud credits claimed, API key in `.env`, SDK installed
- [ ] LLM provider key(s) for the Reason/CodeEdit pipeline nodes in `.env`
- [x] `.env.example` written, `.env` gitignored
- [ ] Demo scenario locked (Section 5) — do not change it after this phase ends

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

- [ ] L1 live and publishing (target: 15+ events across one simulated session)
- [ ] L2 live and publishing (one record per graph write)
- [ ] L3 live and publishing (one record per pipeline node execution)
- [ ] Replay-from-offset demonstrated at least once — rebuild the resume context from the L1 tail,
      not from whatever's currently in memory

### FalkorDB — continuous writes + 3 distinct query patterns + per-task graph + agent write-back

| # | Operation | Type | Purpose |
|---|---|---|---|
| F1 | `MERGE` writes from the L1→graph consumer | Write | Build Task/Step/Decision/File/Blocker nodes as the session runs |
| F2 | Context reconstruction query | Read | Traverse Task → Steps → Decisions to build the LLM prompt |
| F3 | Blocker/dependency lookup query | Read | Find open Blocker nodes and what File/Step they touch |
| F4 | Hybrid graph + vector query | Read | Find similar past-resolved blockers (vector similarity over Decision embeddings) as precedent for the agent |
| F5 | Per-task graph | Config | One graph per active task (multi-tenant), not one shared graph |
| F6 | Agent write-back | Write | RocketRide pipeline writes new Step/Decision nodes as it completes work, closing the loop |

- [ ] Schema finalized (Section 2)
- [ ] F1 writes confirmed live in FalkorDB Browser
- [ ] F2, F3, F4 each run and return real results at least once
- [ ] F5 confirmed — two separate task graphs exist simultaneously
- [ ] F6 confirmed — graph shows agent-authored nodes distinct from human-authored ones

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
- [ ] Agree the exact demo task (Section 5) — freeze it

### Phase 1 — Capture layer (Hour 1–3) — covers L1, L2

- [ ] Build session simulator (CLI or small script) that emits realistic scripted events: file
      edits, a terminal command, a "tried X, switching to Y because Z" note, a failing test
- [ ] Wire simulator → LaserData `dev.session.events` (L1)
- [ ] Build the L1 → FalkorDB consumer; confirm writes; wire mirrored writes to
      `relay.graph.mutations` (L2)

### Phase 2 — Memory layer (Hour 1–3.5, parallel with Phase 1) — covers F1–F5

- [ ] Finalize Cypher schema (Section 2)
- [ ] Implement F2, F3, F4 queries; run each against real data
- [ ] Confirm F5 — a second task graph exists independently

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
| 2 | 2026-08-03 11:34 PDT | 0 | Guild.ai, LaserData, RocketRide, FalkorDB | SDK verification | Checked every assumed package against the live npm registry before writing calls, as AGENTS.md requires | `rocketride@1.3.0` and `falkordb@6.7.0` resolve; `@guild-ai/sdk`, `laserdata`, `@laserdata/client`, `laserdata-client` all return npm 404 | done |
| 3 | 2026-08-03 11:48 PDT | 4 | RocketRide | R1 + R2 pipeline definitions | Rewrote both `.pipe` files against the extension's component schemas; built a catalog-driven offline validator and confirmed it rejects a broken pipeline | `pipeline/relay-capture.pipe`, `pipeline/relay-resume.pipe`, `orchestration/src/pipeline_lint.ts`; `npm run check` reports both pipelines structurally valid; negative test produced 3 correct errors | done (definitions only — no run token yet) |
| 4 | 2026-08-03 11:52 PDT | 3 | Guild.ai | G1/G2/G3 + triggers | Implemented all three agents with real run bodies and an audited-session runner; registered both trigger types | `orchestration/src/guild/`, `evidence/guild-sessions.jsonl`; `npm run guild:register` → 3 agents, 5 triggers (local transport) | done (local — does not satisfy the Guild dashboard requirement) |
| 5 | 2026-08-03 11:58 PDT | 3 | Guild.ai, RocketRide | Credential-scope gate | Ran G2 with no credentials; it refused to start rather than running unscoped, and G1 refused on the missing LaserData URL | `npm run resume` → `"Refused to run: ROCKETRIDE_TARGET_REPO is unset — refusing to run an unscoped agent."` | done |
| | | | | | | | |

**Open against Section 1 from Track 2:** every runtime row for LaserData L3 offsets, FalkorDB
F6 nodes, Guild session ids, and RocketRide run/trace ids is still unfilled. They need `.env`
credentials and a frozen demo repo (Section 5), not more code.

---

## Section 5 — Demo scenario (freeze at end of Phase 0)

- Repo: `<toy repo name>`
- Feature: `<e.g. "add rate limiting to /api/checkout">`
- Scripted arc: dev tries sliding-window → too complex → switches to token-bucket → test fails on
  an edge case → dev leaves
- Narration script: `<5 lines, one per demo beat, matching README → Demo>`

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
