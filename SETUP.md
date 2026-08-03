# Setting up on a new machine

Everything in this file is what git does **not** carry. The code is all in the
repo; what follows is the environment around it.

Rough order, ~10 minutes if the credentials are to hand.

## 1. Prerequisites

- **Node 20+** (built and verified on v24.18.0). No `engines` floor is declared,
  but `tsx` and the SDKs assume a modern Node.
- **FalkorDB on port 6379.** This is the one piece of infrastructure the demo
  genuinely needs; the graph is not optional.

  ```bash
  docker run -p 6379:6379 -p 3000:3000 -it --rm falkordb/falkordb:latest
  ```

  Any FalkorDB works — Docker, a native `redis-server` with the module loaded,
  or FalkorDB Cloud. Point `FALKORDB_URL` at whichever you use. Verify with:

  ```bash
  redis-cli -p 6379 GRAPH.LIST
  ```

## 2. Dependencies

Two `package.json` files need installing. `demo/toy-repo` has no dependencies
(it runs on `node --test`), so leave it alone.

```bash
npm install                      # root: capture, memory, scripts, demo
npm install --prefix orchestration   # Track 2's Guild + RocketRide layer
```

## 3. `.env` — the part that is never in git

Copy `.env.example` and fill it in. Nothing here is recoverable from the repo;
these values come from the sponsor dashboards.

```bash
cp .env.example .env
```

| Variable | Where it comes from | Without it |
| -------- | ------------------- | ---------- |
| `ROCKETRIDE_APIKEY` | RocketRide dashboard (`rr_…`) | R1/R2 never start |
| `ROCKETRIDE_ANTHROPIC_KEY` | console.anthropic.com (`sk-ant-…`) | Pipelines start but fail at the model node |
| `LASER_CONNECTION_STRING` | LaserData instance → Connect tab | Streams fall back to fixture mode |
| `FALKORDB_URL` | Your local instance | Graph layer fails |
| `GUILD_WORKSPACE_ID` | `019fc934-b21e-3bb9-0000-6ce317801803` | Only needed by the gateway transport |
| `ROCKETRIDE_GITHUB_TOKEN` | Fine-grained PAT, this repo only | No PR is opened |
| `SLACK_WEBHOOK_URL` | Slack app config | NotifySlack no-ops |

Also set the two mode flags, or the demo silently runs on fixtures:

```env
FALKOR_MODE=live
LASER_MODE=fixture     # flip to live once the connection string works
```

> The RocketRide and LaserData keys used on 3 Aug were pasted into a chat
> transcript. **Rotate them** rather than copying them to the new machine.

## 4. Guild CLI

The CLI stores its OAuth token in the OS keychain, so it does not travel.

```bash
npm install -g @guildai/cli
guild auth login
guild workspace select relay
```

The three agents are already published server-side — you do **not** rebuild
them. Their working copies are gitignored (each is its own git repo pointed at
Guild). Clone them only if you need to edit an agent:

```bash
cd agents
guild agent clone krishivsagrawal~relay-resume
guild agent clone krishivsagrawal~relay-context-summarizer
guild agent clone krishivsagrawal~relay-pr-risk-review
```

`guild auth login` also configures npm access to the private
`@guildai/agents-sdk`, which those agents import. Without the login, an agent
directory will not install.

Reviewable copies of all three agents' source are committed as
`agents/*.agent.ts`, so you can read them without cloning.

## 5. GitHub push access

```bash
gh auth login          # HTTPS + "configure git with your GitHub credentials"
```

Without it, pushes fail with `could not read Username for 'https://github.com'`.
If Homebrew is unavailable, the standalone binary works:
`https://github.com/cli/cli/releases` → `gh_*_macOS_arm64.zip` → drop `gh` in
`~/.local/bin`.

## 6. Optional: `.rocketride/`

The RocketRide VS Code extension writes a `.rocketride/` directory (component
catalog, per-node schemas, docs) next to the workspace. It is gitignored because
it is large and machine-generated.

It is **not** required to run anything. Without it, the offline pipeline
validator (`npm run check --prefix orchestration`) reports
`services catalog not found — lane checks skipped` and still validates
structure, GUIDs and env references. Install the extension to get lane and
control-plane checking back.

## 7. Verify

```bash
npm run check --prefix orchestration          # offline: env + pipeline structure
npm run check --prefix orchestration -- --live  # hits RocketRide, FalkorDB, LaserData, GitHub

npm run demo -- --reset
npm run demo
```

A healthy run ends with `tests passing after 2 attempt(s)` — attempt 1 must
fail. If it passes on attempt 1, the toy repo is already patched; `--reset`
fixes that.

Anything without credentials prints `degraded` with the reason, so the run tells
you what is missing rather than pretending.

## What regenerates itself

Do not go looking for these — they are rebuilt on demand:

- `.laserdata-fixtures/`, `.falkordb-fixtures/` — fixture stream/graph stores;
  stage 1 of the demo clears and repopulates them
- `demo/autopilot-monitor/events/*.jsonl` — presence and handoff logs
- `evidence/*.jsonl` — written fresh on each agent run
- `node_modules/` in both packages
