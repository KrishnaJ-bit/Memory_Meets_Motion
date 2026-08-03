import "dotenv/config";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FalkorDB } from "falkordb";

const execFileAsync = promisify(execFile);

type Check = {
  name: string;
  ok: boolean;
  detail: string;
};

type CommandProbe = {
  command: string;
  args: string[];
};

function hasValue(name: string): boolean {
  return typeof process.env[name] === "string" && process.env[name]!.trim().length > 0;
}

async function commandExists(command: string, args: string[] = ["--version"]): Promise<Check> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { timeout: 10_000 });
    const firstLine = `${stdout}${stderr}`.trim().split(/\r?\n/)[0] ?? "available";
    return { name: command, ok: true, detail: firstLine };
  } catch {
    return { name: command, ok: false, detail: "not available in PATH" };
  }
}

async function commandExistsAny(name: string, probes: CommandProbe[]): Promise<Check> {
  for (const probe of probes) {
    const check = await commandExists(probe.command, probe.args);
    if (check.ok) return { ...check, name };
  }

  return { name, ok: false, detail: "not available in PATH" };
}

async function commandStatus(
  name: string,
  probes: CommandProbe[],
  successPattern?: RegExp
): Promise<Check> {
  for (const probe of probes) {
    try {
      const { stdout, stderr } = await execFileAsync(probe.command, probe.args, { timeout: 15_000 });
      const output = `${stdout}${stderr}`.trim();
      if (/not authenticated|not logged in/i.test(output)) {
        return { name, ok: false, detail: output.split(/\r?\n/)[0] ?? "not ready" };
      }
      if (!successPattern || successPattern.test(output)) {
        return { name, ok: true, detail: output.split(/\r?\n/)[0] ?? "ok" };
      }
      return { name, ok: false, detail: output.split(/\r?\n/)[0] ?? "not ready" };
    } catch (error) {
      const maybeOutput =
        typeof error === "object" && error !== null && "stdout" in error && "stderr" in error
          ? `${(error as { stdout?: string }).stdout ?? ""}${(error as { stderr?: string }).stderr ?? ""}`.trim()
          : "";
      if (maybeOutput) return { name, ok: false, detail: maybeOutput.split(/\r?\n/)[0] ?? "failed" };
    }
  }

  return { name, ok: false, detail: "not available" };
}

async function checkGitHubCli(): Promise<Check> {
  const probes =
    process.platform === "win32"
      ? [
          { command: "C:\\Program Files\\GitHub CLI\\gh.exe", args: ["--version"] },
          { command: "gh", args: ["--version"] }
        ]
      : [{ command: "gh", args: ["--version"] }];
  return commandExistsAny("gh", probes);
}

async function checkGitHubAuth(): Promise<Check> {
  if (hasValue("GITHUB_TOKEN")) {
    return { name: "GitHub auth", ok: true, detail: "GITHUB_TOKEN set" };
  }

  const probes =
    process.platform === "win32"
      ? [
          { command: "C:\\Program Files\\GitHub CLI\\gh.exe", args: ["auth", "status"] },
          { command: "gh", args: ["auth", "status"] }
        ]
      : [{ command: "gh", args: ["auth", "status"] }];
  return commandStatus("GitHub auth", probes, /Logged in|Active account/i);
}

async function checkGuildAuth(): Promise<Check> {
  const probes =
    process.platform === "win32"
      ? [
          {
            command: "node",
            args: [
              "C:\\Users\\nagar\\AppData\\Roaming\\npm\\node_modules\\@guildai\\cli\\bin\\guild.js",
              "auth",
              "status"
            ]
          },
          { command: "guild", args: ["auth", "status"] }
        ]
      : [{ command: "guild", args: ["auth", "status"] }];
  return commandStatus("Guild auth", probes, /authenticated|logged in/i);
}

async function checkFalkorDB(): Promise<Check> {
  try {
    // Bug fix: this used to hard-code localhost:6379 regardless of FALKORDB_URL, so it
    // reported MISSING even when a real (e.g. cloud) FalkorDB was reachable and configured.
    const rawUrl = process.env.FALKORDB_URL;
    const connectOptions = rawUrl
      ? (() => {
          const u = new URL(rawUrl);
          return {
            username: u.username || undefined,
            password: u.password || undefined,
            socket: { host: u.hostname, port: u.port ? Number(u.port) : 6379 },
          };
        })()
      : {
          username: process.env.FALKOR_USERNAME || undefined,
          password: process.env.FALKOR_PASSWORD || undefined,
          socket: { host: process.env.FALKOR_HOST || "localhost", port: Number(process.env.FALKOR_PORT || 6379) },
        };
    const db = await FalkorDB.connect(connectOptions);
    const graph = db.selectGraph("relay_env_check");
    await graph.query("MERGE (:SetupCheck {id: $id})", { params: { id: "env-check" } });
    const result = await graph.query("MATCH (n:SetupCheck {id: $id}) RETURN count(n) AS count", {
      params: { id: "env-check" }
    });
    await db.close();
    return { name: "FALKORDB_URL", ok: true, detail: `MERGE/read ok (${JSON.stringify(result.data)})` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { name: "FALKORDB_URL", ok: false, detail: message };
  }
}

const checks: Check[] = [];

checks.push({
  name: "GITHUB_USERNAME",
  ok: hasValue("GITHUB_USERNAME"),
  detail: hasValue("GITHUB_USERNAME") ? "set" : "missing"
});
checks.push({
  name: "GITHUB_ACCOUNT_EMAIL",
  ok: hasValue("GITHUB_ACCOUNT_EMAIL"),
  detail: hasValue("GITHUB_ACCOUNT_EMAIL") ? "set" : "missing"
});
checks.push({
  name: "LaserData credentials",
  ok: hasValue("LASER_CONNECTION_STRING") || (hasValue("LASERDATA_API_TOKEN") && hasValue("LASERDATA_STREAM_URL")),
  detail: hasValue("LASER_CONNECTION_STRING") ? "LASER_CONNECTION_STRING set" : "missing"
});
checks.push({
  name: "Guild workspace",
  ok: hasValue("GUILD_WORKSPACE_ID"),
  detail: hasValue("GUILD_WORKSPACE_ID") ? "set" : "missing"
});
checks.push({
  name: "RocketRide credentials",
  ok: hasValue("ROCKETRIDE_APIKEY") || hasValue("ROCKETRIDE_API_KEY"),
  detail: hasValue("ROCKETRIDE_APIKEY") || hasValue("ROCKETRIDE_API_KEY") ? "set" : "missing"
});
checks.push({
  name: "LLM provider key",
  ok: hasValue("OPENAI_API_KEY") || hasValue("ANTHROPIC_API_KEY"),
  detail: hasValue("OPENAI_API_KEY") || hasValue("ANTHROPIC_API_KEY") ? "set" : "missing"
});

checks.push(await commandExistsAny("node", [{ command: "node", args: ["--version"] }]));
checks.push(
  await commandExistsAny(
    "npm",
    process.platform === "win32"
      ? [
          { command: "node", args: ["C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js", "--version"] },
          { command: "npm", args: ["--version"] }
        ]
      : [{ command: "npm", args: ["--version"] }]
  )
);
checks.push(
  await commandExistsAny(
    "guild",
    process.platform === "win32"
      ? [
          {
            command: "node",
            args: ["C:\\Users\\nagar\\AppData\\Roaming\\npm\\node_modules\\@guildai\\cli\\bin\\guild.js", "--version"]
          },
          { command: "guild", args: ["--version"] }
        ]
      : [{ command: "guild", args: ["--version"] }]
  )
);
checks.push(await checkGuildAuth());
checks.push(await commandExistsAny("docker", [{ command: "docker", args: ["--version"] }]));
checks.push(await checkGitHubCli());
checks.push(await checkGitHubAuth());
checks.push(await checkFalkorDB());

for (const check of checks) {
  const icon = check.ok ? "OK" : "MISSING";
  console.log(`${icon.padEnd(7)} ${check.name.padEnd(26)} ${check.detail}`);
}

const missingCritical = checks.filter((check) => !check.ok);
process.exitCode = missingCritical.length > 0 ? 1 : 0;
