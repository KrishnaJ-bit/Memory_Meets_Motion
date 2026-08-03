# Pipeline

RocketRide pipeline definitions for Relay (Track 2 — see
`execution/CLAUDECODE_2_ORCHESTRATION_PIPELINE.md`).

Both files were written against the schemas the RocketRide VS Code extension
publishes in `.rocketride/` (catalog + per-component JSON schema) and validated
offline by `orchestration/src/pipeline_lint.ts`, which checks lane compatibility,
control-plane `invoke` minimums, source-node config and GUID rules.

## R1 — `relay-capture.pipe`

Backs the Guild `context-summarizer` agent (G1). Source is a **webhook**, so it
is driven with `client.send()`, not `client.chat()`.

```text
webhook → summarization → question → agent_rocketride → response_answers
             [llm]                        [llm, memory, http tool]
```

| Node                | Provider            | Role                                                            |
| ------------------- | ------------------- | --------------------------------------------------------------- |
| `webhook_1`         | `webhook`           | Ingest a batch of L1 `dev.session.events`                        |
| `summarization_1`   | `summarization`     | Summarize(LLM) — compresses the batch                            |
| `question_1`        | `question`          | text → questions, so the emitter agent can consume the summary   |
| `agent_rocketride_1`| `agent_rocketride`  | EmitDecision — returns structured decisions as its answer        |
| `llm_anthropic_1`   | `llm_anthropic`     | `claude-haiku-4-5`, shared by the summarizer and the agent       |

The agent does **not** publish to LaserData itself. LaserData's SDK speaks Apache
Iggy over TCP, so no RocketRide HTTP tool can reach it; the G1 Guild agent takes
the returned decisions and writes them to L2 through the SDK.

## R2 — `relay-resume.pipe`

Backs the Guild `relay-resume` agent (G2). Source is **chat**, so it is driven
with `client.chat()`.

```text
chat → agent_rocketride_1 (Reason) → response_answers
         ├── llm_anthropic_reason  claude-haiku-4-5 ← cheap/fast model
         ├── memory_internal_1
         ├── tool_falkordb_1     read-only          ← FetchGraphContext (F2/F3/F4)
         ├── tool_http_request_1 Slack              ← NotifySlack
         └── agent_rocketride_2 (CodeEdit, invoked as a tool)
               ├── llm_anthropic_codeedit  claude-opus-4-6 ← stronger model
               ├── memory_internal_2
               ├── tool_python_1    TestRunner
               ├── tool_github_1    OpenPR
               └── tool_falkordb_2  write-enabled   ← F6 agent write-back
```

**Multi-model routing** is the `claude-haiku-4-5` / `claude-opus-4-6` split: the
reasoning agent plans on the cheap, fast model, and only the code-edit sub-agent
gets the expensive one. Both pipelines run entirely on Claude, so one Anthropic
key powers the whole system.

**ReplayEventTail is not a node.** LaserData's SDK is Iggy-over-TCP, so nothing
inside a RocketRide pipeline can read the log. The G2 Guild agent replays the L1
tail from the given offset through the SDK and hands it to R2 as `event_tail` in
the question context — the replay is still real and still offset-based, it just
happens one layer out. Same for L3: `orchestration/src/trace_ingest.ts` turns
this pipeline's own component traces into `relay.agent.actions` records.

**The retry loop** is the sub-agent's wave loop, not a graph cycle — RocketRide
pipelines are DAGs, so a `TestRunner → Reason` back-edge is not expressible.
`agent_rocketride_2` runs the tests, revises, and re-runs, capped at three
attempts by its instructions and `max_waves`; the parent re-delegates on failure
and stops after three delegations.

## Governance built into the pipeline

- Both HTTP tools carry a `urlWhitelist` regex — the agents cannot reach a host
  outside LaserData/Slack even if the model tries.
- `tool_falkordb_1` runs with `allow_writes: false` (server-enforced
  `GRAPH.RO_QUERY`); only the code-edit sub-agent's `tool_falkordb_2` can write.
- `tool_github_1` uses `defaultRepo` so calls that omit a repo cannot wander.

## Running them

Never by hand — the Guild agents own the lifecycle:

```bash
cd orchestration
npm install
npm run check          # offline validation
npm run check -- --live  # server-side validate() + credential checks
npm run capture -- --task <task_id> --offset <l1_offset>
npm run resume  -- --task <task_id> --goal "..." --offset <l1_offset>
```

Runs are started with `pipelineTraceLevel: 'summary'`. Without it RocketRide
emits no `apaevt_flow` events, and the L3 action stream and trace evidence would
both be empty.

## Environment

Every `${ROCKETRIDE_*}` reference in these files is documented in `.env.example`.
`port`, `tls` and `allow_writes` are literals because RocketRide only substitutes
string values — change the FalkorDB port here, not in `.env`.
