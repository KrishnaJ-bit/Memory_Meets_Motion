# Guild agents

The three Relay agents as they exist on Guild's servers. Created with the Guild
CLI, published, and added to the `krishivsagrawal/relay` workspace.

Each agent is its own git repository with Guild as the remote, so the working
copies (`relay-*/`) are gitignored here. The `*.agent.ts` files beside this
README are reviewable mirrors of the source that is actually deployed.

| # | Agent | Agent ID | Version | Purpose |
|---|-------|----------|---------|---------|
| G1 | `relay-context-summarizer` | `019fc939-8d66-726e-0000-97803b16e34d` | 1.0.1 | Compress raw session telemetry into structured decisions — the *why*, not the *what* |
| G2 | `relay-resume` | `019fc937-a87d-726e-0000-bdf6e8e7c06b` | 1.0.1 | Inherit an interrupted task from graph memory + event tail, finish it, open an explaining PR |
| G3 | `relay-pr-risk-review` | `019fc939-9b97-726e-0000-d9ae2351982c` | 1.0.1 | Check the resume agent's claims against its own diff before a human sees it |

Workspace: `krishivsagrawal/relay` — `019fc934-b21e-3bb9-0000-6ce317801803`

## Audited sessions

Guild runs these on its own models, so they work without a local LLM key.

| Agent | Session ID | What it actually produced |
|-------|-----------|---------------------------|
| G1 | `019fc93e-2149-351a-0000-00673a67d8ca` | Correct structured decision from raw events: abandoned sliding-window, reasoning captured, next step inferred |
| G2 | `019fc93e-8429-351a-0000-fda34993c104` | Diagnosed the real bug — "strict inequality `>` instead of `>=` on time differences" — from graph memory alone, without reading the file |
| G3 | `019fc93f-587c-351a-0000-d5d23319ac5c` | Flagged that the PR body never states a test result; rated the one-line diff low risk |

G2's session is the one worth showing. It never saw `rateLimit.js`; it inferred
the fix purely from the decisions and the blocker the previous session left in
the graph. That is the entire thesis of the project in one output.

## Working on them

```bash
guild agent clone krishivsagrawal~relay-resume
cd relay-resume
# edit agent.ts
git add . && git commit -m "..."
guild agent save --message "..." --wait --publish
```

Never `git push` from inside an agent directory — a pre-push hook blocks it.
Use `guild agent save`.

## Triggers

The trigger wiring (manual button, idle-timeout, `github.pr.opened`) lives in
`orchestration/src/guild/agents.ts`, which is what the local demo drives. These
hosted agents are the same three roles running on Guild's infrastructure.
