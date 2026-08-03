import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { prepareAutopilot, finalizeAutopilot, type PendingApproval, type Stage } from "../demo/relay/autopilot.js";

const root = path.resolve("demo/autopilot-monitor");
const eventDir = path.join(root, "events");
const port = Number(process.env.AUTOPILOT_DEMO_PORT ?? 4173);

// In-memory only: this is a single-operator local demo server, not a
// multi-tenant service. A run's pending state lives here between the
// "prepare" SSE stream finishing and the human clicking Approve/Decline.
const pendingRuns = new Map<string, PendingApproval>();

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

/** Minimal SSE helper: one `event:`/`data:` frame per call, flushed immediately. */
function sseWrite(response: ServerResponse, event: string, data: unknown): void {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function startSse(response: ServerResponse): void {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });
}

/** GET /api/autopilot/prepare-stream?task_id=...&offset=... — streams every stage live. */
async function handlePrepareStream(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
  const taskId = url.searchParams.get("task_id") ?? undefined;
  const offset = Number(url.searchParams.get("offset") ?? "0");
  const runId = randomUUID();

  startSse(response);
  sseWrite(response, "run_id", { run_id: runId });

  try {
    const pending = await prepareAutopilot({
      taskId,
      replayOffset: Number.isFinite(offset) ? offset : 0,
      onProgress: (stage: Stage) => sseWrite(response, "stage", stage)
    });
    pendingRuns.set(runId, pending);
    sseWrite(response, "ready", { run_id: runId, pending });
  } catch (error) {
    sseWrite(response, "error", { message: error instanceof Error ? error.message : String(error) });
  } finally {
    response.end();
  }
}

/** GET /api/autopilot/approve-stream?run_id=...&approved=true|false — streams the finalize stages. */
async function handleApproveStream(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
  const runId = url.searchParams.get("run_id") ?? "";
  const approved = url.searchParams.get("approved") === "true";
  const pending = pendingRuns.get(runId);

  startSse(response);

  if (!pending) {
    sseWrite(response, "error", { message: `Unknown run_id ${runId} — the server may have restarted since prepare.` });
    response.end();
    return;
  }

  try {
    // finalizeAutopilot doesn't take onProgress (its stage list is short and
    // returned whole), so stream a synthetic "starting" frame, run it, then
    // replay each of its stages as its own SSE frame for a consistent feed.
    sseWrite(response, "stage", { name: "finalize_start", status: "live", detail: approved ? "Starting finalize: opening PR if tests passed." : "Starting finalize: recording the decline, no PR." });
    const result = await finalizeAutopilot(pending, approved);
    const newStages = result.stages.slice(pending.stages.length);
    for (const stage of newStages) sseWrite(response, "stage", stage);
    sseWrite(response, "done", result);
    pendingRuns.delete(runId);
  } catch (error) {
    sseWrite(response, "error", { message: error instanceof Error ? error.message : String(error) });
  } finally {
    response.end();
  }
}

async function handleApi(request: IncomingMessage, response: ServerResponse, url: URL) {
  if (url.pathname === "/api/autopilot/prepare-stream" && request.method === "GET") {
    await handlePrepareStream(request, response, url);
    return;
  }
  if (url.pathname === "/api/autopilot/approve-stream" && request.method === "GET") {
    await handleApproveStream(request, response, url);
    return;
  }

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
