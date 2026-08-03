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
| `src/laserdata.ts`     | L1 replay-by-offset + L2/L3 publish over `@laserdata/laser-sdk` (Iggy transport) |
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

Checked against the public npm registry on 2026-08-03, and corrected against
Codex's `docs/credential-setup.md`:

| Sponsor    | AGENTS.md assumed | Reality                                                                  |
| ---------- | ----------------- | ------------------------------------------------------------------------ |
| RocketRide | TS/Python SDK     | **`rocketride@1.3.0`** — installed, used directly                        |
| FalkorDB   | official driver   | **`falkordb@6.7.0`** — installed, used directly                          |
| LaserData  | typed Node client | **`@laserdata/laser-sdk@0.0.1`** — installed, used directly              |
| Guild.ai   | `@guild-ai/sdk`   | That name is a 404. The real SDK is **`@guildai/agents-sdk`, private** — it needs `guild auth login` to configure npm access first |

Two corrections worth knowing, because both changed the design:

1. **LaserData was found late.** An earlier version of `laserdata.ts` spoke HTTP
   against a `LASERDATA_STREAM_URL` because the package had not been located
   under the names AGENTS.md implied. It exists under the `@laserdata` scope.
2. **LaserData is not HTTP.** Its transport is Apache Iggy over TCP/QUIC, so a
   RocketRide `tool_http_request` node cannot publish or replay to it. That is
   why L1 replay, the L2 decision writes, and the L3 action stream all happen
   here in `orchestration/` rather than inside the pipelines — the pipelines
   receive the replayed tail as question context and return decisions as answers.

Guild remains the one unverified surface: its SDK is private, so
`GuildTransport` still fronts the gateway HTTP API and the route names in
`src/guild/client.ts` → `ROUTES` are guesses. The base URL is now
`https://app.guild.ai/api` (from Codex's verified setup), not `gateway.guild.ai`.
Once someone runs `guild auth login` and `npm install @guildai/agents-sdk`
succeeds, implement `GuildTransport` against the real SDK and delete `ROUTES`. Nothing in
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
