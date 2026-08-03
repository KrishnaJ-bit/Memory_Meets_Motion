import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { runAutopilot } from "../demo/relay/autopilot.js";

const root = path.resolve("demo/autopilot-monitor");
const eventDir = path.join(root, "events");
const port = Number(process.env.AUTOPILOT_DEMO_PORT ?? 4173);

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function send(response: ServerResponse, statusCode: number, body: string, contentType = "text/plain; charset=utf-8") {
  response.writeHead(statusCode, { "content-type": contentType });
  response.end(body);
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.length > 0 ? JSON.parse(raw) : {};
}

async function appendJsonl(filename: string, value: unknown) {
  await mkdir(eventDir, { recursive: true });
  await writeFile(path.join(eventDir, filename), `${JSON.stringify(value)}\n`, { flag: "a" });
}

async function handleApi(request: IncomingMessage, response: ServerResponse, url: URL) {
  if (request.method !== "POST") {
    send(response, 405, JSON.stringify({ error: "method_not_allowed" }), "application/json; charset=utf-8");
    return;
  }

  const body = await readBody(request);

  if (url.pathname === "/api/activity-events") {
    await appendJsonl("presence-events.jsonl", body);
    send(response, 200, JSON.stringify({ ok: true }), "application/json; charset=utf-8");
    return;
  }

  if (url.pathname === "/api/autopilot/start") {
    // This used to return a canned list of what autopilot *would* do. It now
    // actually runs it: replay the L1 tail, rebuild context from the graph,
    // patch the code, run the real test suite, and write the agent's work back
    // to FalkorDB. Each stage reports whether it ran live or degraded.
    const handoff = body as { task_id?: string; payload?: { idle_ms?: number; reason?: string } };
    const startedAt = new Date().toISOString();

    let run: Awaited<ReturnType<typeof runAutopilot>> | undefined;
    let failure: string | undefined;
    try {
      run = await runAutopilot({ taskId: handoff.task_id, replayOffset: 0 });
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }

    const autopilotRun = {
      autopilot_id: `autopilot-${Date.now()}`,
      mode: run?.testsPassed ? "completed" : failure ? "failed" : "finished_with_failures",
      started_at: startedAt,
      received: body,
      result: run
        ? {
            tests_passed: run.testsPassed,
            attempts: run.attempts,
            patch_applied: run.patchApplied,
            graph: run.graph,
            l3_records: run.l3Records,
            stages: run.stages.map((stage) => ({ name: stage.name, status: stage.status, detail: stage.detail }))
          }
        : { error: failure }
    };

    await appendJsonl("autopilot-handoffs.jsonl", autopilotRun);
    send(response, run || !failure ? 200 : 500, JSON.stringify(autopilotRun), "application/json; charset=utf-8");
    return;
  }

  send(response, 404, JSON.stringify({ error: "not_found" }), "application/json; charset=utf-8");
}

async function serveStatic(request: IncomingMessage, response: ServerResponse, url: URL) {
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(root, requested));

  if (!filePath.startsWith(root)) {
    send(response, 403, "forbidden");
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      send(response, 404, "not found");
      return;
    }
    const ext = path.extname(filePath);
    const content = await readFile(filePath);
    response.writeHead(200, { "content-type": contentTypes[ext] ?? "application/octet-stream" });
    response.end(content);
  } catch {
    send(response, 404, "not found");
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }
    await serveStatic(request, response, url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    send(response, 500, JSON.stringify({ error: message }), "application/json; charset=utf-8");
  }
});

server.listen(port, () => {
  console.log(`Relay autopilot presence monitor running at http://localhost:${port}`);
});
