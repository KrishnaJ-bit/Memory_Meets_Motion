# Credential Setup

Last verified: 2026-08-03.

## Automated Locally

- Node.js and npm are installed and working.
- Git user identity is configured as `Sameer Nagar <nagarsam8989@gmail.com>`.
- Project dependencies are installed:
  - `@laserdata/laser-sdk`
  - `falkordb`
  - `rocketride`
  - `dotenv`
  - `zod`
- Guild CLI `0.17.0` is installed globally.
- GitHub CLI `2.97.0` is installed.
- FalkorDB is running locally in Docker as `relay-falkordb` on ports `6379` and `3000`.
- `.env` exists locally with non-secret defaults and account identifiers.

## Remaining Interactive Logins

These steps require browser OAuth or dashboard-generated tokens. Do not paste tokens into chat.

### Guild.ai

```sh
guild auth login
guild workspace select
guild auth status
```

After login, Guild stores OAuth tokens in Windows Credential Manager and configures npm access for
private Guild packages. Then install the private agent SDK if needed:

```sh
npm install @guildai/agents-sdk
```

### GitHub

Use the installed GitHub CLI:

```sh
"C:\Program Files\GitHub CLI\gh.exe" auth login --hostname github.com --git-protocol https --scopes repo,read:org,workflow
"C:\Program Files\GitHub CLI\gh.exe" auth status
```

If you later need a headless token for scripts, place it in `.env` as `GITHUB_TOKEN`. Keep it out
of committed files.

### LaserData

The current TypeScript SDK reads:

```env
LASER_CONNECTION_STRING=
LASER_STREAM=dev
```

Use the LaserData dashboard or hackathon-provided local stack to obtain the connection string.
The SDK also supports `Laser.connectEnv()`.

### RocketRide

The current TypeScript SDK reads:

```env
ROCKETRIDE_APIKEY=
ROCKETRIDE_URI=wss://api.rocketride.ai
```

Generate the API key in RocketRide Cloud, then put it in `.env`.

### LLM Providers

Set at least one provider key for RocketRide Reason and CodeEdit nodes:

```env
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
```

## Verify Without Printing Secrets

```sh
npm run env:check
guild doctor
docker ps --filter name=relay-falkordb
```
