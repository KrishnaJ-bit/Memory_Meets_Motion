# Claude Code Track 1 - Capture + Memory

Owner tool: Claude Code #1

Mission: build the event capture layer and the FalkorDB memory layer so Relay can prove what
happened, replay it, and reconstruct task context without relying on local process memory.

## Status: work plan complete in fixture mode; live-mode swap is one env var away, blocked on
infra/credentials this machine doesn't have — see "Blocker note" below.

## Start Here

1. Read `AGENTS.md`, `EXECUTION.md`, `CHANGELOG.md`, and this file before editing.
2. Work on branch `feature/claudecode-capture-memory`.
3. Confirm current LaserData and FalkorDB SDK/client commands from live docs or `--help` before
   writing integration code.
4. Update the task log below after every meaningful step.
5. Update `CHANGELOG.md` for every committed change.
6. Add real evidence to `EXECUTION.md` Section 4 for each completed sponsor touchpoint.

## Claimed Paths

Primary paths:

- `capture/`
- `memory/`
- `scripts/` files used for session simulation, replay, graph seeding, or graph inspection
- `src/shared/` event-envelope and graph-contract files, if a shared TypeScript package is added
- `execution/CLAUDECODE_1_CAPTURE_MEMORY.md`
- `fixtures/`

Avoid editing unless coordinated:

- `orchestration/`
- `pipeline/`
- `demo/`
- `README.md`, `EXECUTION.md`, and `CHANGELOG.md` outside required log/changelog rows

## Blocker note (read first)

This machine had, at track start: no Docker/container runtime, no Homebrew, and no LaserData
Cloud or FalkorDB Cloud credentials. That blocks any live TCP/Redis connection to either sponsor
service. The approach taken (confirmed with the user before writing integration code):

1. Install the real `@laserdata/laser-sdk` (0.0.1, published ~1 day before this track ran) and
   `falkordb` (6.7.0) npm packages and read their actual `README.md` + `dist/**/*.d.ts` to verify
   every method name/signature used below — nothing here is guessed from training-data memory of
   "how these products probably work."
2. Write real adapter code against those verified APIs (`capture/src/laser/liveClient.ts`,
   `memory/src/falkor/liveClient.ts`), gated behind `LASER_MODE=live` / `FALKOR_MODE=live`.
3. Default to a documented local fallback (`fixtureClient.ts` in each of those two directories)
   implementing the identical adapter interface, so every caller in `capture/`, `memory/`, and
   `scripts/` is unaffected by which mode is active. Not a mock of the business logic — the
   fixture adapter mirrors the exact ON CREATE/ON MATCH MERGE semantics of `memory/schema/*.cypher`,
   evidenced by `execution/evidence/seed_graph_replay_idempotent.out` showing a second full
   replay from offset 0 applies the same 44 mutations and leaves F5 node counts unchanged.
4. F4 (similar past-resolved blocker lookup) additionally needs an embedding provider to produce
   vectors for FalkorDB's real vector index (`memory/schema/f4_similar_resolved_blocker_lookup.cypher`,
   `CALL db.idx.vector.queryNodes(...)` over `Decision.embedding`) — no embedding provider
   credentials were available either. `memory/src/queries/f4.ts` uses a documented keyword-overlap
   (Jaccard) fallback over `Decision.text`/`reasoning` instead, joined to blockers by `step_id`
   (the same decision -> step -> blocker traversal the live Cypher uses); swapping in real
   embeddings later only changes the scoring function.

**Schema/event-type reconciliation.** The first pass of this track (before this note was written)
independently designed its own event-type enum and graph schema (10 event types, a
`Blocker-[:DEPENDS_ON]->Dependency` model) without reading root `EXECUTION.md` Section 2, because
that file didn't exist in the local working copy this session started from. Once pushed to a
branch and the real `origin/main` (with the full root `EXECUTION.md`, `AGENTS.md`, and the other
two tracks' execution files) was discovered, everything in `capture/`, `memory/`, and
`src/shared/` was rewritten to match Section 2 exactly: `event_type` is now
`file_save | terminal_cmd | diff | note | graph_write | agent_action` (task/step/decision/blocker
semantics ride on `note.payload.kind`), and the FalkorDB schema is now
`Task/Step/Decision/File/Blocker` with `MODIFIES`/`BLOCKED_BY`/`MADE_DURING`/`NEXT` edges. One
deliberate addition beyond Section 2's own (incomplete) edge list: `Task-[:HAS_STEP]->Step` — see
the comment atop `src/shared/graph-contract.ts` for why F2 needs it. F3 and F4 were also
re-derived from Section 1's own wording for what they mean ("open Blocker nodes and what
File/Step they touch"; "similar past-resolved blockers via Decision-embedding vector similarity")
rather than the first pass's invented `Blocker->Dependency` model. This happened *before* Track 2
or Track 3 had built anything against the old shape, so no downstream breakage resulted — but it's
why the git history on this branch contains a schema rewrite partway through.

None of the evidence below is fabricated: every `execution/evidence/*.out` file is real command
output from this session, and `fixtures/*.json` were generated by `scripts/build_fixtures.ts`
against the same code paths a live run would use.

## Sponsor Coverage

| Sponsor | Owned or supported work | Required evidence |
|---|---|---|
| LaserData | Own L1 `dev.session.events`; own L2 `relay.graph.mutations`; expose replay-from-offset contract for Codex and RocketRide. | Stream names, offsets, event counts, replay command/output — see Evidence below. |
| FalkorDB | Own F1-F5: idempotent `MERGE` writes, schema, F2/F3/F4 reads, per-task graph isolation. | Cypher files, query output, graph names — see Evidence below. FalkorDB Browser screenshot N/A: no live server reachable (documented blocker). |
| Guild.ai | Support G1/G2 by publishing stable event and context payload shapes. | Contract file path and sample payload consumed by Track 2. |
| RocketRide | Support R1/R2 with replay/query functions usable from pipeline nodes. | Function path, fixture path, and one successful local invocation. |

## Work Plan

- [x] Create the session simulator that emits realistic dev events using the required event
      envelope: `session_id`, `task_id`, `event_type`, `timestamp`, `payload`.
      (`capture/src/simulator.ts`, emitting the canonical `file_save|terminal_cmd|diff|note` types)
- [x] Publish at least 15 simulator events to LaserData stream L1: `dev.session.events`.
      (26 events per session; see evidence)
- [x] Implement replay-from-offset for L1 and save command output for the execution log.
      (`scripts/replay_l1.ts`, evidence below)
- [x] Create the FalkorDB schema files and use only `MERGE` for replay-safe writes.
      (`memory/schema/*.cypher`)
- [x] Build the L1-to-FalkorDB consumer and mirror every graph write to LaserData stream L2:
      `relay.graph.mutations`. (`memory/src/consumer.ts`, mirrored as `graph_write` events)
- [x] Implement F2 context reconstruction: Task -> Steps -> Decisions.
      (`memory/schema/f2_context_reconstruction.cypher`, `memory/src/queries/f2.ts`)
- [x] Implement F3 blocker/dependency lookup.
      (Re-derived as F3's actual definition — "open Blocker nodes and what File/Step they touch":
      `memory/schema/f3_blocker_file_step_lookup.cypher`, `memory/src/queries/f3.ts`)
- [x] Implement F4 similar blocker/decision lookup using available vector support or a documented
      fallback fixture if vector support is blocked. (vector support blocked — see Blocker note;
      keyword-overlap fallback in `memory/src/queries/f4.ts`, joined via shared `step_id`)
- [x] Confirm F5 with two active task graphs at the same time.
      (`memory/src/queries/f5.ts`, evidence below: `task_alpha` + `task_beta` inspected together)
- [x] Package sample payloads for Track 2 and Track 3 in a stable fixture location.
      (`fixtures/`, generated by `scripts/build_fixtures.ts`)

## Handoff Contract

- **LaserData stream names, auth env vars, replay command**: `fixtures/README.md`
  ("Stream / graph names and env vars" + "Replay command" sections).
- **JSON fixture with >=15 L1 events**: `fixtures/l1_dev_session_events.json` (26 events).
- **FalkorDB graph names, connection env vars, Cypher query files for F2/F3/F4**:
  `memory/schema/*.cypher`; graph naming convention `graphNameForTask()` in
  `src/shared/graph-contract.ts`; env vars in `fixtures/README.md` and root `.env.example`.
- **Blocked sponsor SDK calls and fallback used**: see "Blocker note" above.

## Evidence (real command output, this session)

- `execution/evidence/simulate_session.out` — `npx tsx scripts/simulate_session.ts alpha 1` and
  `... beta 2`
- `execution/evidence/replay_l1_offset10.out` — `npx tsx scripts/replay_l1.ts 10`
- `execution/evidence/replay_l2_sample.out` — `npx tsx scripts/replay_l2.ts 0 3` (real
  `graph_write` envelope records with MERGE-count metadata)
- `execution/evidence/inspect_graph_f2_f3_f4_f5.out` — `npx tsx scripts/inspect_graph.ts alpha
  beta` (F2/F3/F4/F5 all in one run, two simultaneous task graphs; F4 shows a real cross-graph hit)
- `execution/evidence/seed_graph_first_run.out` + `seed_graph_replay_idempotent.out` — running
  `npx tsx scripts/seed_graph.ts 0` twice: same 44 mutations applied both times, F5 node counts
  identical after the second run (idempotent MERGE, replay-safe).

## Task Log

| # | Time | Action | Sponsors | Evidence | Status |
|---|---|---|---|---|---|
| 1 | 2026-08-03 11:19 PDT | Track created and assigned to Claude Code #1. | LaserData, FalkorDB, Guild.ai, RocketRide | `execution/CLAUDECODE_1_CAPTURE_MEMORY.md` | ready |
| 2 | 2026-08-03 11:24 PDT | Confirmed no Docker/Homebrew/credentials on this machine; verified LaserData and FalkorDB are real, current SDKs by installing `@laserdata/laser-sdk@0.0.1` and `falkordb@6.7.0` from npm and reading their actual README + `.d.ts` files. Asked user how to proceed; user chose documented local fixture fallback. | LaserData, FalkorDB | conversation record | done |
| 3 | 2026-08-03 11:26 PDT | Bootstrapped a local git repo (no root docs existed in the working copy yet) and built the full capture/memory layer against a self-designed event envelope and graph schema. | — | initial commit on a local-only branch | superseded (see #6) |
| 4 | 2026-08-03 12:10 PDT | `npx tsc --noEmit` clean; ran the full simulate -> replay -> seed -> inspect pipeline against the self-designed schema; committed. | LaserData, FalkorDB | — | superseded (see #6) |
| 5 | 2026-08-03 12:20 PDT | User asked to push to a new branch. Found the real GitHub remote already has a fuller `origin/main` (root `AGENTS.md`/`EXECUTION.md` with Section 1/2 sponsor requirements and schema, plus `CLAUDECODE_2_ORCHESTRATION_PIPELINE.md` and `CODEX_3_INTEGRATION_DEMO.md`) that the local working copy never had. Re-based this branch onto real `origin/main` and re-applied only this track's paths. | — | `git log --oneline origin/main`, `git ls-tree -r --name-only origin/main` | done |
| 6 | 2026-08-03 12:35 PDT | Rewrote `src/shared/envelope.ts`, `src/shared/graph-contract.ts`, `capture/src/simulator.ts`, all of `memory/schema/*.cypher`, both FalkorDB adapters, the consumer, and F2-F5 query modules to match root `EXECUTION.md` Section 1/2 exactly (see "Schema/event-type reconciliation" above). Re-verified FalkorDB range/vector index Cypher syntax against docs.falkordb.com during this pass. | LaserData, FalkorDB | `memory/schema/*.cypher`, `src/shared/*.ts` | done |
| 7 | 2026-08-03 12:45 PDT | Reconciled env var names: `capture/src/laser/liveClient.ts` now reads `LASERDATA_STREAM_URL` (falling back to `LASER_CONNECTION_STRING`); `memory/src/falkor/liveClient.ts` now reads `FALKORDB_URL` (falling back to discrete `FALKOR_HOST`/`PORT`/`USERNAME`/`PASSWORD`). Updated root `.env.example` with both. | LaserData, FalkorDB | `.env.example`, `capture/src/laser/liveClient.ts`, `memory/src/falkor/liveClient.ts` | done |
| 8 | 2026-08-03 12:55 PDT | Re-ran the full pipeline on the canonical schema: published 27 events each to `task_alpha`/`task_beta`, replayed L1 from offset 10, seeded the graph (44 mutations), ran F2/F3/F4/F5 together (F4 returned a real cross-graph hit), replayed L2 (real `graph_write` envelopes), re-ran the consumer from offset 0 a second time and confirmed F5 node counts were unchanged. | LaserData, FalkorDB | `execution/evidence/*.out` | done |
| 9 | 2026-08-03 13:00 PDT | Rebuilt `fixtures/` (`scripts/build_fixtures.ts`) and rewrote `fixtures/README.md` for the canonical schema/event types; this fixture's demo session deliberately leaves its blocker open so `f3_sample_blocker_lookup.json` isn't empty. | Guild.ai, RocketRide | `fixtures/*.json`, `fixtures/README.md` | done |
| 10 | 2026-08-03 13:05 PDT | `npx tsc --noEmit` clean across `capture/`, `memory/`, `scripts/`, `src/shared/` on the rebased branch. | — | — | done |

## Change Discipline

Every code or doc change must update `CHANGELOG.md`. Every completed runtime sponsor touchpoint
must update `EXECUTION.md` Section 4 with real evidence, not a placeholder.
