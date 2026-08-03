# Orchestration

The governed agent layer for Relay (Track 2). Guild.ai agents G1–G3, the
RocketRide runners for R1/R2, LaserData L3 publishing, and the FalkorDB F6
write-back.

## Layout

| File                   | What it does                                                                   |
| ---------------------- | ------------------------------------------------------------------------------ |
| `src/guild/agents.ts`  | G1 `context-summarizer`, G2 `relay-resume`, G3 `pr-risk-review` — real run bodies |
| `src/guild/types.ts`   | Agent/trigger/scope contract                                                    |
| `src/guild/client.ts`  | `GuildTransport` seam: gateway HTTP transport + local audit-log fallback         |
| `src/guild/runner.ts`  | Opens an audited Guild session per run, streams log lines into it                |
| `src/guild/register.ts`| Registers agents + both trigger types, prints ids for the Execution Log          |
| `src/rocketride.ts`    | Starts R1/R2 with `pipelineTraceLevel: 'summary'`, sends batches / questions     |
| `src/trace_ingest.ts`  | Turns `apaevt_flow` traces into L3 `relay.agent.actions` records                 |
| `src/laserdata.ts`     | L1 replay-by-offset + L2/L3 publish, using the AGENTS.md event envelope          |
| `src/falkordb.ts`      | F6 agent write-back (MERGE only) and the agent-authored-node evidence query      |
| `src/github.ts`        | Credential-scope gate for G2, PR read + review comment for G3                    |
| `src/pipeline_lint.ts` | Offline `.pipe` validator driven by `.rocketride/services-catalog.json`          |
| `src/check.ts`         | Setup checker (`npm run check`, `npm run check -- --live`)                       |

## Commands

```bash
npm install
npm run check                # offline: env, pipeline structure, credentials present
npm run check -- --live      # also: RocketRide validate(), FalkorDB, LaserData, GitHub scope
npm run guild:register       # register agents + triggers, print ids
npm run capture -- --task <task_id> --offset <l1_offset>
npm run resume  -- --task <task_id> --goal "<goal>" --offset <l1_offset> [--idle]
npx tsx src/run_review.ts -- --task <task_id> --pr <number>
npm run typecheck
```

`--idle` makes G2 record the run under the idle-timeout trigger instead of the
manual button, so both trigger types are demonstrable from one code path.

## SDK status — read before wiring anything else

Checked against the public npm registry on 2026-08-03:

| Sponsor    | AGENTS.md assumed  | Reality                                                    |
| ---------- | ------------------ | ---------------------------------------------------------- |
| RocketRide | TS/Python SDK      | **`rocketride@1.3.0` — real, installed, used directly**     |
| FalkorDB   | official driver    | **`falkordb@6.7.0` — real, installed, used directly**       |
| Guild.ai   | `@guild-ai/sdk`    | **404 on npm.** No client package found under any spelling  |
| LaserData  | typed Node client  | **404 on npm** (`laserdata`, `@laserdata/client`, …)        |

So Guild and LaserData are reached over HTTP behind one interface each
(`GuildTransport`, `LaserDataClient`). The Guild route names in
`src/guild/client.ts` → `ROUTES` are the only unverified surface in this track;
confirm them against Guild's live docs and edit that one object. Nothing in
`agents.ts` depends on them.

Without Guild credentials the agents still run, against `LocalGuildTransport`,
which writes the same audit trail to `evidence/guild-sessions.jsonl`. That keeps
the pipelines testable before the Guild account exists — but a local session id
is **not** evidence for EXECUTION.md §1, which asks for sessions visible in
Guild's dashboard.

## Evidence produced

Every run writes to `evidence/` at the repo root:

- `agent-actions-<run-token>.jsonl` — one record per pipeline node execution,
  the same payloads published to L3 `relay.agent.actions`
- `guild-sessions.jsonl` — session start/step/end records (local transport only)

Both are written before the network call, so a LaserData outage costs you the
stream, not the audit trail.

## Handoff to Track 3

`npm run guild:register` prints agent + trigger ids; `npm run resume` prints the
RocketRide run token, the replay offset consumed, the per-task graph name, and
the F6 write-back counts. Those are the values Track 3 needs for the Execution
Log.
