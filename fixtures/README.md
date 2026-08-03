# Fixtures — Track 1 handoff

Stable sample payloads for Track 2 (Codex) and Track 3 (RocketRide) to integrate against without
needing a running LaserData or FalkorDB instance. Regenerate with `npm run build-fixtures`
(`scripts/build_fixtures.ts`) — it's deterministic (fixed seed, fixed timestamps).

| File | What it is |
|---|---|
| `l1_dev_session_events.json` | 26 events (>=15 required) for one simulated task (`task_id: demo-task`), in the L1 `dev.session.events` envelope shape (`src/shared/envelope.ts`). |
| `l2_graph_mutations_sample.json` | Every graph mutation record mirrored to L2 `relay.graph.mutations` while seeding the graph from the L1 fixture above — each one a `graph_write` event whose `payload` is `src/shared/graph-contract.ts:GraphMutationPayload`. |
| `f2_sample_context.json` | Sample output of F2 (context reconstruction) for `demo-task`. |
| `f3_sample_blocker_lookup.json` | Sample output of F3 (open Blocker + File/Step lookup) for `demo-task` — this fixture's session deliberately leaves its blocker unresolved so the sample isn't empty. |

## Event envelope contract (Guild.ai G1/G2, and anyone consuming L1 directly)

Field names and `event_type` values are exactly root `EXECUTION.md` Section 2's:

```ts
interface DevSessionEvent {
  session_id: string;
  task_id: string;
  event_type: "file_save" | "terminal_cmd" | "diff" | "note" | "graph_write" | "agent_action";
  timestamp: string; // ISO-8601 UTC
  payload: Record<string, unknown>;
}
```

L1 (`dev.session.events`) only uses `file_save | terminal_cmd | diff | note` — the full task/step
lifecycle, decisions, and blockers all ride on `note`, discriminated by `payload.kind`:
`task_started | task_completed | step_started | step_completed | decision | blocker_encountered |
blocker_resolved`. `graph_write` is L2's event_type (produced by the consumer); `agent_action` is
Track 2's L3 event_type. Full payload shapes and the `kind` discriminator are in
`src/shared/envelope.ts`; validated by `assertDevSessionEvent`.

## Graph node/edge shapes (root `EXECUTION.md` Section 2, Track 1's F1 subset)

```
(:Task {id, title, status, session_id, created_at})
(:Step {id, task_id, order, description, status, started_at, completed_at})
(:Decision {id, task_id, step_id, text, reasoning, embedding})
(:File {path})
(:Blocker {id, task_id, step_id, description, resolved, created_at, resolved_at})

(Task)-[:HAS_STEP]->(Step)      // deliberate addition beyond Section 2 — see src/shared/graph-contract.ts
(Step)-[:NEXT]->(Step)
(Decision)-[:MADE_DURING]->(Step)
(Step)-[:BLOCKED_BY]->(Blocker)
(Step)-[:MODIFIES]->(File)
```

`Session`/`Person`/`Agent` nodes and F6 (agent write-back) are Track 2's, not modeled here.

## Query functions (RocketRide R1/R2 pipeline nodes)

Import directly from `memory/src/queries/`:

- `reconstructContext(taskId: string): Promise<F2Result>` — `memory/src/queries/f2.ts` (F2)
- `lookupOpenBlockers(taskId: string): Promise<F3Result[]>` — `memory/src/queries/f3.ts` (F3 —
  "Find open Blocker nodes and what File/Step they touch")
- `findSimilarResolvedBlockers(newBlockerDescription: string, k?: number)` —
  `memory/src/queries/f4.ts` (F4 — hybrid graph + Decision-similarity query, keyword-overlap
  fallback pending an embedding provider)
- `checkGraphIsolation(graphs?: string[])` — `memory/src/queries/f5.ts` (F5)

Each opens its own client via `LASER_MODE` / `FALKOR_MODE` env vars (default `fixture`, see
below) and closes it before returning — safe to call one-shot from a pipeline node.

## Stream / graph names and env vars

| Name | Value |
|---|---|
| L1 stream | `dev.session.events` |
| L1 topic | `sessions` |
| L2 stream | `relay.graph.mutations` |
| L2 topic | `mutations` |
| FalkorDB graph naming | `task_<task_id>` (`graphNameForTask` in `src/shared/graph-contract.ts`) — one graph per task, never shared |
| `LASER_MODE` | `fixture` (default, file-backed JSONL under `.laserdata-fixtures/`) or `live` (real `@laserdata/laser-sdk`, needs `LASERDATA_STREAM_URL` or `LASER_CONNECTION_STRING` — see root `.env.example`) |
| `FALKOR_MODE` | `fixture` (default, file-backed JSON under `.falkordb-fixtures/`) or `live` (real `falkordb` client, needs `FALKORDB_URL` or discrete `FALKOR_HOST`/`FALKOR_PORT`/`FALKOR_USERNAME`/`FALKOR_PASSWORD` — see root `.env.example`) |

## Replay command

```sh
npm run replay -- <fromOffset>              # replays L1 dev.session.events from an offset
npx tsx scripts/replay_l2.ts <fromOffset>   # replays L2 relay.graph.mutations from an offset
```

Both work unmodified against a live LaserData stream once `LASER_MODE=live` and the connection
env var above are set — no other code changes required.

## Known blocker / fallback (read before assuming live behavior)

This machine has no Docker/container runtime and no LaserData Cloud / FalkorDB Cloud
credentials, so none of the above has been run against a live endpoint — everything here was
produced in fixture mode. The adapters (`capture/src/laser/`, `memory/src/falkor/`) are written
against the real SDKs and are a one-line env var away from live mode; see
`execution/CLAUDECODE_1_CAPTURE_MEMORY.md` for the full note. F4's vector similarity is also
blocked (no embedding provider) — it currently uses a documented keyword-overlap fallback (see
`memory/src/queries/f4.ts`).
