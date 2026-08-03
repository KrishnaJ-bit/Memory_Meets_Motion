# Demo runbook

Two ways to run the same story. The terminal version is the reliable one; the
browser version is the one that shows a human being watched and then leaving.

## Before you start

```bash
npm install
# FalkorDB must be listening on 6379. Check:
redis-cli -p 6379 GRAPH.LIST   # or: npx tsx scripts/verify-env.ts
```

Every command below assumes these three variables. Put them in `.env` or export
them:

```bash
export FALKOR_MODE=live
export FALKORDB_URL=redis://localhost:6379
export LASER_MODE=fixture      # flip to `live` once LASER_CONNECTION_STRING is set
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
| 4 | Autopilot inherits the task: replays the tail from offset 0, reads the graph, patches the code, runs the tests for real, retries, closes the blocker |
| 5 | The graph now contains agent-authored nodes and the blocker is resolved |

The retry is genuine: attempt 1 fails on the boundary assertion, the patch is
applied, attempt 2 passes. Nothing asserts a green suite it did not observe.

## B. Browser demo (presence → autopilot)

```bash
npm run demo -- --reset
npm run demo -- --stage 1
npm run demo -- --stage 2     # graph is now seeded with the interrupted task
npm run demo:autopilot        # http://localhost:4173
```

In the browser:

1. Move the mouse and type — the mouse/click/keyboard rows go **active**.
2. Optionally click **Enable camera** to add camera-motion presence.
3. Then do one of: stop touching anything until the idle countdown hits zero,
   switch tabs, or click **Simulate leaving**.
4. `developer_absent` fires and the autopilot handoff panel fills with the real
   run — stages, attempts, the graph name, and the L3 record count.

That panel is not a script. `POST /api/autopilot/start` executes the same
`runAutopilot()` the terminal demo calls.

## What is live and what is not

| Layer | Status without credentials |
| ----- | -------------------------- |
| FalkorDB (F1, F2, F3, F5, F6) | **Live** against local FalkorDB |
| Test runner + retry loop | **Live** — real `npm test` in `demo/toy-repo` |
| Presence detection | **Live** — real mouse/click/keyboard/visibility/camera-motion |
| LaserData L1/L2/L3 | **Fixture mode** — file-backed store, same interface; flip `LASER_MODE=live` |
| RocketRide R1/R2 | **Not running** — needs `ROCKETRIDE_APIKEY`; the code edit falls back to the deterministic fix implied by the inherited blocker |
| Guild.ai G1–G3 | **Local audit transport** — needs `guild auth login` and the private `@guildai/agents-sdk` |
| PR + Slack | **Not running** — needs `GITHUB_TOKEN` / `SLACK_WEBHOOK_URL` |

Every stage prints `live` or `degraded`, so this table is visible in the run
itself. Say it out loud during the demo rather than letting a judge find it.

## If something breaks on stage

- **"already indexed"** — you are on an old checkout; `ensureSchema` tolerates
  re-runs as of this branch.
- **F3 returns 0 open blockers** — a previous rehearsal already resolved it. Run
  `npm run demo -- --reset` first; stage 1 also drops the task graph.
- **Tests pass on attempt 1** — the toy repo is already patched. Same fix:
  `npm run demo -- --reset`.
- **Nothing at :4173** — the port is taken; `AUTOPILOT_DEMO_PORT=4174 npm run demo:autopilot`.
