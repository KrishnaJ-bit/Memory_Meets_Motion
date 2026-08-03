# Demo runbook

Two ways to run the same story. The terminal version is the reliable one; the
browser version is the one that shows a human being watched, leaving, and then
approving the fix before it ships.

## Before you start

```bash
npm install
npm install --prefix orchestration
npx tsx scripts/verify-env.ts   # or: redis-cli -p 6379 GRAPH.LIST if using local FalkorDB
```

Every command below assumes `.env` is filled in (`cp .env.example .env`, then
see `SETUP.md`). At minimum:

```bash
FALKOR_MODE=live
FALKORDB_URL=redis://<user>:<pass>@<host>:<port>   # FalkorDB Cloud works fine, not just Docker
LASER_MODE=fixture      # flip to `live` once LASER_CONNECTION_STRING is set
GUILD_WORKSPACE_ID=...  # from `guild workspace current` after `guild auth login`
ROCKETRIDE_APIKEY=...
ROCKETRIDE_GEMINI_KEY=... # pipeline/*.pipe's Reason/CodeEdit nodes (see below re: billing)
GITHUB_TOKEN=...        # fine-grained PAT, scoped to this repo only
```

## A. Terminal demo (5 stages, ~30 seconds)

```bash
npm run demo -- --reset   # put the toy repo and graph back to the interrupted state
npm run demo
```

| Stage | What the audience sees |
| ----- | ---------------------- |
| 1 | 22 events from a real working session land on LaserData `dev.session.events` |
| 2 | The consumer turns that stream into a FalkorDB graph, mirroring each write to L2 |
| 3 | **The point of the project**: F2 replays the decisions *and the reasoning* — why sliding-window was abandoned, why token-bucket won — and F3 shows the blocker the developer left open |
| 4 | Autopilot inherits the task: Guild's G1 (`context-summarizer`) compresses the session, replays the tail from offset 0, reads the graph, patches the code, runs the tests for real, retries — then auto-approves (the terminal script narrates the human gate instead of waiting on a click) and opens a real PR, reviewed by G3 (`pr-risk-review`) |
| 5 | The graph now contains agent-authored nodes and the blocker is resolved |

The retry is genuine: attempt 1 fails on the boundary assertion, the patch is
applied, attempt 2 passes. Nothing asserts a green suite it did not observe.

## B. Browser demo (presence → autopilot → human approval)

```bash
npm run demo -- --reset
npm run demo -- --stage 1
npm run demo -- --stage 2     # graph is now seeded with the interrupted task
npm run demo:autopilot        # http://localhost:4173
```

In the browser:

1. Move the mouse and type — the mouse/click/keyboard rows go **active**.
2. Then do one of: stop touching anything until the idle countdown hits zero,
   switch tabs, or click **Simulate leaving**. (No camera — presence is
   mouse/click/keyboard/tab-visibility only.)
3. `developer_absent` fires and the live event feed streams every real stage as
   it happens: G1 running, the L1 replay, F2/F3 graph reads, the RocketRide
   attempt, each test run.
4. Once tests pass, an **Approve & open PR** gate appears and waits for a
   click — Relay does not open a PR unattended. Decline is a real, first-class
   outcome (F6 still writes back; no PR opens).
5. On approve, the PR opens for real and the feed shows G3 (`pr-risk-review`)
   reviewing it. The finale is the real PR URL — not a custom "success" screen.

That feed is not a script: `GET /api/autopilot/prepare-stream` and
`GET /api/autopilot/approve-stream` are Server-Sent Events streaming
`prepareAutopilot()` / `finalizeAutopilot()` from `demo/relay/autopilot.ts` —
the same functions the terminal demo calls.

## What is live and what is not

| Layer | Status |
| ----- | ------ |
| FalkorDB (F1, F2, F3, F5, F6) | **Live** — verified against a real FalkorDB Cloud instance (`redis://...:55419`), not just local Docker |
| Test runner + retry loop | **Live** — real `npm test` in `demo/toy-repo` |
| Presence detection | **Live** — real mouse/click/keyboard/tab-visibility, no camera |
| Guild.ai G1 / G3 | **Live** — real `invokeAgent()` calls, real Guild-audited sessions (workspace `krishnaj-bit/relay`); G1 completed a full run producing real decisions before hitting the Gemini quota below |
| Human approval gate | **Live** — a real pause between "tests pass" and "PR opens"; nothing after this point runs without a click |
| GitHub PR + G3 review | **Live once approved** — real branch/commit/PR via `github.createPullRequest()`, real G3 review comment |
| LaserData L1/L2/L3 | **Fixture mode** — file-backed store, same interface; flip `LASER_MODE=live` once a connection string exists |
| RocketRide R1/R2 (the LLM reasoning itself) | **Connects live**, but the Gemini key(s) tried so far hit real free-tier quota walls (0–20 requests/day) — a Google Cloud billing/provisioning issue, not a code issue. Falls back to the deterministic fix implied by the inherited blocker, clearly labelled `degraded` in the feed. Enable billing on the Gemini project (or supply a funded key) to get a live model call. |
| Slack | **Not running** — needs `SLACK_WEBHOOK_URL` |

Every stage prints `live`, `degraded`, `skipped`, or `failed` in the feed, so
this table is visible in the run itself. Say it out loud during the demo
rather than letting a judge find it.

## If something breaks on stage

- **"already indexed"** — you are on an old checkout; `ensureSchema` tolerates
  re-runs as of this branch.
- **F3 returns 0 open blockers** — a previous rehearsal already resolved it. Run
  `npm run demo -- --reset` first; stage 1 also drops the task graph.
- **Tests pass on attempt 1** — the toy repo is already patched. Same fix:
  `npm run demo -- --reset`.
- **Nothing at :4173** — the port is taken; `AUTOPILOT_DEMO_PORT=4174 npm run demo:autopilot`.
- **RocketRide LLM nodes report a quota/billing error** — real and expected
  until billing is enabled on the Gemini project behind `ROCKETRIDE_GEMINI_KEY`;
  the deterministic fallback still produces a working PR.
