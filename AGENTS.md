# AGENTS.md — Relay

You (Codex) are building **Relay** for the Memory Meets Motion hackathon (Aug 3 2026, Frontier
Tower SF, 8-hour build sprint). Read this file at the start of every session before touching code.

## What we're building

An AI system that captures why work was done, not just what changed, and can finish an
interrupted task on its own. Every action during a dev session streams into a durable event log.
A live knowledge graph is built from that stream: steps, decisions, blockers, dependencies. When
the session pauses, a governed agent reads the graph and the recent event tail, and finishes the
work — opening a PR that explains what it inherited and what it did.

## Hard requirement — read this twice

Judging rewards **meaningful, repeated use of each sponsor's technology**, not a single token API
call per sponsor. Every sponsor must be exercised multiple times, in multiple distinct ways, over
the course of the build and the demo. The specific minimum touchpoints are defined in
`EXECUTION.md` → Section 1 ("Sponsor Usage Requirements") — do not undercut that list. If you find
a shortcut that reduces a sponsor's usage to one call, don't take it. Find the version that keeps
it real and multi-instance, even under time pressure. This is a design constraint, not a
nice-to-have.

## Source of truth for the plan

`EXECUTION.md` is the actual build plan and the live log. Before writing any code:

1. Read `EXECUTION.md` in full.
2. Work phase by phase, in the order listed. Don't skip ahead to a later phase because it's more
   interesting than the current one.
3. After completing each numbered step, check its box in `EXECUTION.md` **and** add a row to the
   Execution Log table (Section 4) with a real timestamp and real evidence — an actual response
   payload, query result, session ID, run trace, or file path. Never write a placeholder like
   "done" with no evidence attached; that defeats the entire point of the log.
4. If a step turns out to be impossible in the time remaining, don't silently drop it. Mark it
   `[blocked]` in the checklist with a one-line reason, and check the fallback plan in Section 6.

## Stack

- **LaserData** — durable streaming, Node/TS typed client. Confirm exact package name and client
  shape against current docs before assuming syntax.
- **FalkorDB** — OpenCypher via the official driver, or FalkorDB Cloud. Docker fallback:
  `docker run -p 6379:6379 -p 3000:3000 -it --rm falkordb/falkordb:latest`
- **Guild.ai** — `@guild-ai/sdk`, agents defined as code (`agent({ name, triggers, run })` shape).
- **RocketRide** — pipelines as portable JSON / `.pipe` files, TS or Python SDK, run via RocketRide
  Cloud or the local runtime.

Pick one primary language — recommend TypeScript, since Guild's SDK and RocketRide's SDK both
have first-class TS support and LaserData's client is typed for exactly this kind of agent
coordination. Python is fine for the FalkorDB consumer if that's faster to get working.

**None of the exact SDK method names above are guaranteed current.** Check each sponsor's live
docs or `--help` output before writing calls against assumed syntax — these tools ship fast and
this brief may be stale by the time you're reading it.

## Credentials

All sponsor credentials go in `.env`, never hardcoded, never committed. See `.env.example` for
expected variable names — confirm exact names against each sponsor's current docs, since the
placeholders here are illustrative.

## Conventions

- Every event published to LaserData carries: `session_id`, `task_id`, `event_type`, `timestamp`,
  `payload`.
- Every FalkorDB write is a Cypher `MERGE`, never a raw `CREATE`, so replay is idempotent.
- Every Guild agent run must produce a session that gets referenced in the Execution Log.
- Every RocketRide pipeline run must be traceable — capture the run/trace ID and log it.
- Keep the demo scenario (EXECUTION.md → Section 5) frozen after Phase 0. Don't redesign it at
  hour 5.

## Definition of done

- The 5-step demo (see `README.md` → Demo) runs end-to-end at least once, live.
- A backup recording of one clean run exists in `demo/`.
- `EXECUTION.md` → Section 4 (Execution Log) has real entries for every sponsor touchpoint listed
  in Section 1.
- The slide deck references each sponsor by name with what was actually built, not just installed.
