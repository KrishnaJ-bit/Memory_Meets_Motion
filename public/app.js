// Oto.ai autopilot monitor.
//
// Two halves, and the difference matters:
//
//   ACT 1 (the developer) is a re-enactment. The typing is a scripted replay of
//   the session already recorded in demo/fixture-events.jsonl, so the story is
//   watchable on demand. Presence itself — mouse, keys, clicks, tab visibility,
//   camera motion — is genuinely measured from this browser.
//
//   ACT 2 (autopilot) is not theatre. Every feed row is a stage streamed over
//   SSE from prepareAutopilot()/finalizeAutopilot(), the same functions the
//   terminal demo calls, hitting the same real LaserData/FalkorDB/RocketRide/
//   Guild systems. The status on each row is whatever the backend reported.

const sessionId = `presence-${Date.now()}`;
const taskId = "task-checkout-rate-limit";

const $ = (id) => document.querySelector(id);

const modeBadge = $("#modeBadge");
const modeBadgeText = $("#modeBadgeText");
const presenceVerdict = $("#presenceverdict");
const agentPhase = $("#agentPhase");
const agentAvatar = $("#agentAvatar");
const agentThought = $("#agentThought");
const idleCountdown = $("#idleCountdown");
const idleRingFill = $("#idleRingFill");
const idleSeconds = $("#idleSeconds");
const feed = $("#feed");
const approvalGate = $("#approvalGate");
const approveButton = $("#approveButton");
const declineButton = $("#declineButton");
const finale = $("#finale");
const finaleEyebrow = $("#finaleEyebrow");
const finaleLink = $("#finaleLink");
const finaleSub = $("#finaleSub");
const cameraFeed = $("#cameraFeed");
const cameraProbe = $("#cameraProbe");
const cameraButton = $("#cameraButton");
const cameraPlaceholder = $("#cameraPlaceholder");
const cameraFrame = $("#cameraFrame");
const cameraHint = $("#cameraHint");
const cameraStatus = $("#cameraStatus");
const recDot = $("#recDot");
const motionBar = $("#motionBar");
const editorCode = $("#editorCode");
const caret = $("#caret");
const captureTicker = $("#captureTicker");
const simulateButton = $("#simulateButton");
const leaveButton = $("#leaveButton");
const resetButton = $("#resetButton");

const signals = {
  mouse: $("#sigMouse"),
  keys: $("#sigKeys"),
  clicks: $("#sigClicks"),
  tab: $("#sigTab"),
  motion: $("#sigMotion")
};

const counters = { events: $("#cEvents"), steps: $("#cSteps"), attempts: $("#cAttempts"), l3: $("#cL3") };

const mesh = {
  laser: { node: $("#nodeLaser"), link: $("#linkLaser"), meta: $("#metaLaser") },
  falkor: { node: $("#nodeFalkor"), link: $("#linkFalkor"), meta: $("#metaFalkor") },
  rocket: { node: $("#nodeRocket"), link: $("#linkRocket"), meta: $("#metaRocket") },
  guild: { node: $("#nodeGuild"), link: $("#linkGuild"), meta: $("#metaGuild") }
};
const meshCount = $("#meshCount");
const nodeCore = $("#nodeCore");

const IDLE_RING_CIRCUMFERENCE = 327;

let lastActivityAt = Date.now();
let clickCount = 0;
let autopilotActive = false;
let simulationRunning = false;
let currentRunId = null;
let stream;
let previousFrame;
let capturedEvents = 0;

/* ── plumbing ──────────────────────────────────────────────────────── */

const envelope = (eventType, payload) => ({
  session_id: sessionId,
  task_id: taskId,
  event_type: eventType,
  timestamp: new Date().toISOString(),
  payload
});

function postJson(path, body) {
  fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(
    () => undefined
  );
}

function flashSignal(key, value) {
  const el = signals[key];
  if (!el) return;
  el.querySelector(".signal-value").textContent = value;
  el.dataset.hot = "true";
  clearTimeout(el._cool);
  el._cool = setTimeout(() => {
    el.dataset.hot = "false";
  }, 900);
}

function markActivity(source, detail = {}) {
  if (autopilotActive) return;
  lastActivityAt = Date.now();
  presenceVerdict.dataset.state = "present";
  presenceVerdict.textContent = "present";

  if (source === "mouse") flashSignal("mouse", "moving");
  if (source === "keyboard") flashSignal("keys", "typing");
  if (source === "click") flashSignal("clicks", String(clickCount));

  capturedEvents += 1;
  captureTicker.textContent = `${capturedEvents} events → L1`;
  postJson("/api/activity-events", envelope("note", { note_type: "presence_signal", source, ...detail }));
}

function setMode(mode) {
  modeBadge.dataset.mode = mode;
  modeBadgeText.textContent = mode === "autopilot" ? "Autopilot on" : "Watching";
}

function setAgent(state, thought) {
  agentAvatar.dataset.state = state;
  agentPhase.dataset.state = state;
  agentPhase.textContent = state;
  if (thought) {
    agentThought.hidden = false;
    agentThought.textContent = thought;
  } else {
    agentThought.hidden = true;
  }
}

/* ── the sponsor mesh ──────────────────────────────────────────────── */

// Which backend stage lights which system up. Kept explicit rather than
// pattern-matched so a renamed stage fails visibly instead of silently
// leaving a sponsor dark.
// Names must match the stages emitted by demo/relay/autopilot.ts exactly. They
// were wrong once (guild_context_summarizer vs guild_g1_context_summarizer),
// which left Guild dark on screen while it was genuinely running — the mesh
// under-reported a sponsor rather than over-reporting one, but wrong either way.
const STAGE_TO_SYSTEM = {
  guild_g1_context_summarizer: { key: "guild", meta: "G1 summarizer" },
  guild_g2_governance_check: { key: "guild", meta: "G2 scope gate" },
  guild_g3_pr_risk_review: { key: "guild", meta: "G3 review" },
  replay_event_tail: { key: "laser", meta: "L1 replay" },
  fetch_graph_context: { key: "falkor", meta: "F2 + F3 reads" },
  reason_and_code_edit: { key: "rocket", meta: "R2 pipeline" },
  code_edit: { key: "rocket", meta: "patch applied" },
  falkordb_write_back: { key: "falkor", meta: "F6 write-back" },
  open_pr: { key: "guild", meta: "PR opened" }
};

const engaged = new Set();

function lightSystem(key, meta, status) {
  const target = mesh[key];
  if (!target) return;
  target.node.dataset.live = "true";
  target.node.dataset.degraded = status === "degraded" ? "true" : "false";
  target.link.dataset.live = "true";
  target.meta.textContent = meta;
  engaged.add(key);
  meshCount.textContent = `${engaged.size} / 4 engaged`;
  nodeCore.dataset.active = "true";
}

function resetMesh() {
  engaged.clear();
  for (const { node, link, meta } of Object.values(mesh)) {
    node.dataset.live = "false";
    node.dataset.degraded = "false";
    link.dataset.live = "false";
    meta.textContent = "idle";
  }
  meshCount.textContent = "0 / 4 engaged";
  nodeCore.dataset.active = "false";
  for (const c of Object.values(counters)) c.textContent = "0";
}

/* ── feed ──────────────────────────────────────────────────────────── */

const STATUS_ICON = { live: "●", degraded: "◐", skipped: "○", failed: "✕", human: "▲" };

function addFeedItem(stage) {
  document.querySelector("#feedEmpty")?.remove();

  const li = document.createElement("li");
  li.className = `feed-item feed-item--${stage.status}`;

  const icon = document.createElement("span");
  icon.className = "feed-icon";
  icon.textContent = STATUS_ICON[stage.status] ?? "○";

  const body = document.createElement("div");
  body.className = "feed-body";

  const name = document.createElement("p");
  name.className = "feed-name";
  name.textContent = stage.name.replace(/_/g, " ");

  const detail = document.createElement("p");
  detail.className = "feed-detail";
  detail.textContent = stage.detail;

  body.append(name, detail);
  li.append(icon, body);
  feed.append(li);
  feed.scrollTop = feed.scrollHeight;
  return li;
}

function onStage(stage) {
  addFeedItem(stage);

  const mapped = STAGE_TO_SYSTEM[stage.name];
  if (mapped && stage.status !== "skipped") lightSystem(mapped.key, mapped.meta, stage.status);

  // Counters read out of the stage details the backend already provides.
  const stepMatch = /F2 returned (\d+) step/.exec(stage.detail ?? "");
  if (stepMatch) counters.steps.textContent = stepMatch[1];
  const eventMatch = /replayed (\d+) L1 event/.exec(stage.detail ?? "");
  if (eventMatch) counters.events.textContent = eventMatch[1];
  const attemptMatch = /attempt (\d+)/.exec(stage.detail ?? "");
  if (attemptMatch) counters.attempts.textContent = attemptMatch[1];

  const thoughts = {
    guild_g1_context_summarizer: "compressing the session…",
    guild_g2_governance_check: "checking my own scope…",
    guild_g3_pr_risk_review: "reviewing my own PR…",
    replay_event_tail: "replaying the log…",
    fetch_graph_context: "reading the graph…",
    reason_and_code_edit: "planning the fix…",
    test_runner: "running tests…",
    code_edit: "patching…",
    falkordb_write_back: "writing back…",
    open_pr: "opening the PR…"
  };
  if (thoughts[stage.name]) setAgent("working", thoughts[stage.name]);
}

const EMPTY_FEED_COPY =
  "Autopilot is dormant.\nRun the simulation, or simply stop touching the machine — " +
  "when the idle window closes, every stage below becomes a real call against a real system.";

function clearFeed() {
  feed.innerHTML = "";
  const empty = document.createElement("li");
  empty.className = "feed-empty";
  empty.id = "feedEmpty";
  empty.textContent = EMPTY_FEED_COPY;
  feed.append(empty);
}

function openStream(path, handlers) {
  const source = new EventSource(path);
  for (const [event, handler] of Object.entries(handlers)) {
    source.addEventListener(event, (message) => handler(JSON.parse(message.data), source));
  }
  return source;
}

/* ── ACT 1 · the recorded session, replayed ────────────────────────── */

// The arc from demo/scenario.json, as the developer would have typed it.
const SCRIPT = [
  { t: "// boundary case: bucket must refill at exactly 1000ms\n", c: "cmt" },
  { t: "test(", c: "fn" },
  { t: '"checkout allows one request at the refill boundary"', c: "str" },
  { t: ", () => {\n  ", c: "" },
  { t: "const", c: "kw" },
  { t: " limiter = createTokenBucketLimiter({\n    capacity: ", c: "" },
  { t: "2", c: "num" },
  { t: ",\n    refillPerSecond: ", c: "" },
  { t: "1", c: "num" },
  { t: "\n  });\n\n  checkout(); checkout();\n  currentTime = ", c: "" },
  { t: "1000", c: "num" },
  { t: ";\n\n  assert.equal(checkout().status, ", c: "" },
  { t: "200", c: "num" },
  { t: ");\n});\n", c: "" }
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function typeScript() {
  editorCode.innerHTML = "";
  for (const chunk of SCRIPT) {
    const span = document.createElement("span");
    if (chunk.c) span.className = chunk.c;
    editorCode.append(span);

    for (const ch of chunk.t) {
      span.textContent += ch;
      // Genuine presence signal: the replay is "typing" as far as capture cares.
      if (Math.random() < 0.18) markActivity("keyboard", { key: ch });
      await sleep(ch === "\n" ? 90 : 16 + Math.random() * 26);
    }
  }
}

async function runSimulation() {
  if (simulationRunning || autopilotActive) return;
  simulationRunning = true;
  simulateButton.disabled = true;
  resetWatch({ keepCamera: true });

  addFeedItem({
    name: "session recording",
    status: "human",
    detail: "Developer is writing the boundary test case. Presence signals and file events stream to LaserData L1."
  });

  recDot.dataset.on = "true";
  cameraStatus.textContent = stream ? "recording · camera on" : "recording (no camera)";

  await typeScript();
  caret.style.display = "none";

  addFeedItem({
    name: "test run",
    status: "human",
    detail: "npm test → 1 failing: at exactly 1000 ms the bucket does not refill, so the third request is 429 not 200."
  });
  await sleep(900);

  addFeedItem({
    name: "developer leaves",
    status: "human",
    detail: "Blocker unresolved, task unfinished. This is the moment every other tool forgets what was happening."
  });

  presenceVerdict.dataset.state = "away";
  presenceVerdict.textContent = "away";
  flashSignal("mouse", "still");
  flashSignal("keys", "still");
  await sleep(1100);

  simulationRunning = false;
  startAutopilot("simulated_departure");
}

/* ── ACT 2 · autopilot (real) ──────────────────────────────────────── */

function startAutopilot(reason) {
  if (autopilotActive) return;
  autopilotActive = true;
  simulateButton.disabled = true;
  setMode("autopilot");
  setAgent("waking", "waking up…");
  presenceVerdict.dataset.state = "away";
  presenceVerdict.textContent = "away";
  recDot.dataset.on = "false";

  approvalGate.hidden = true;
  finale.hidden = true;

  addFeedItem({
    name: "developer_absent",
    status: "human",
    detail: `Trigger: ${reason.replace(/_/g, " ")}. Handing the task to the governed relay-resume agent.`
  });

  postJson(
    "/api/activity-events",
    envelope("agent_action", {
      action: "developer_absent",
      reason,
      idle_ms: Date.now() - lastActivityAt,
      handoff: "relay-resume"
    })
  );

  setTimeout(() => setAgent("working", "inheriting the task…"), 600);

  openStream(`/api/autopilot/prepare-stream?task_id=${encodeURIComponent(taskId)}&offset=0`, {
    run_id: (payload) => {
      currentRunId = payload.run_id;
    },
    stage: (stage) => {
      onStage(stage);
      if (stage.name === "awaiting_human_approval") {
        approvalGate.hidden = false;
        setAgent("working", "waiting for a human…");
      }
    },
    ready: (_payload, source) => {
      source.close();
    },
    error: (payload) => {
      onStage({ name: "stream_error", status: "failed", detail: payload.message });
      setAgent("dormant");
    }
  });
}

function respondToApproval(approved) {
  if (!currentRunId) return;
  approvalGate.hidden = true;
  setAgent("working", approved ? "opening the PR…" : "standing down…");

  openStream(`/api/autopilot/approve-stream?run_id=${encodeURIComponent(currentRunId)}&approved=${approved}`, {
    stage: onStage,
    done: (result, source) => {
      source.close();
      setAgent("done", null);
      counters.l3.textContent = String(result.l3Records ?? 0);
      counters.attempts.textContent = String(result.attempts ?? 0);
      finale.hidden = false;

      if (result.prUrl) {
        finaleEyebrow.textContent = result.simulated
          ? "Autopilot finished — simulated PR handoff ready"
          : "Autopilot finished — pull request open";
        finaleLink.href = result.prUrl;
        finaleLink.textContent = result.prUrl;
        finaleSub.textContent = result.simulated
          ? `${result.attempts} simulated test attempt(s) · graph ${result.graph} · ${result.l3Records} L3 record(s)`
          : `${result.attempts} test attempt(s) · graph ${result.graph} · ${result.l3Records} L3 record(s)`;
      } else {
        finaleEyebrow.textContent = approved ? "Approved, but no PR opened" : "Declined — no PR opened";
        finaleLink.removeAttribute("href");
        finaleLink.textContent = "";
        finaleSub.textContent = result.testsPassed
          ? "Tests passed; the PR step was skipped — see the feed for why."
          : `Tests never passed after ${result.attempts} attempt(s) — nothing to approve.`;
      }
    },
    error: (payload) => onStage({ name: "stream_error", status: "failed", detail: payload.message })
  });
}

/* ── camera presence ───────────────────────────────────────────────── */

async function startCamera() {
  if (stream) return;
  try {
    cameraStatus.textContent = "requesting…";
    cameraHint.textContent = "Waiting for camera permission…";

    // getUserMedia can hang indefinitely (headless, or a prompt nobody answers).
    // Without this the panel sits on "requesting…" forever with no explanation.
    stream = await Promise.race([
      navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timed out waiting for camera permission")), 12000)
      )
    ]);
    cameraFeed.srcObject = stream;
    // Safari/Chrome will not always autoplay a freshly attached stream.
    await cameraFeed.play().catch(() => undefined);
    cameraPlaceholder.hidden = true;
    cameraFrame.dataset.camera = "on";
    cameraButton.disabled = true;
    cameraStatus.textContent = "watching";
    flashSignal("motion", "on");
    markActivity("camera", { state: "permission_granted" });
  } catch (error) {
    // Say why. A silent "Camera off" made a denied permission look like a bug.
    const reason =
      error && error.name === "NotAllowedError"
        ? "Permission denied — allow camera access in the address bar, then click again."
        : error && error.name === "NotFoundError"
          ? "No camera found on this machine."
          : `Camera error: ${error instanceof Error ? error.message : String(error)}`;
    cameraHint.textContent = reason;
    cameraStatus.textContent = "unavailable";
    flashSignal("motion", "denied");
    postJson(
      "/api/activity-events",
      envelope("note", {
        note_type: "presence_signal",
        source: "camera",
        state: "permission_denied",
        error: error instanceof Error ? error.message : String(error)
      })
    );
  }
}

function sampleCameraMotion() {
  if (!stream || cameraFeed.readyState < 2) return;

  const context = cameraProbe.getContext("2d", { willReadFrequently: true });
  context.drawImage(cameraFeed, 0, 0, cameraProbe.width, cameraProbe.height);
  const frame = context.getImageData(0, 0, cameraProbe.width, cameraProbe.height).data;

  if (previousFrame) {
    let delta = 0;
    for (let i = 0; i < frame.length; i += 16) delta += Math.abs(frame[i] - previousFrame[i]);
    const motion = delta / (frame.length / 16);

    motionBar.style.width = `${Math.min(100, motion * 9)}%`;

    if (motion > 4) {
      flashSignal("motion", "present");
      if (!autopilotActive) markActivity("camera_motion", { motion: Number(motion.toFixed(2)) });
    } else if (!autopilotActive) {
      signals.motion.querySelector(".signal-value").textContent = "still";
    }
  }

  previousFrame = new Uint8ClampedArray(frame);
}

/* ── reset ─────────────────────────────────────────────────────────── */

function resetWatch({ keepCamera = false } = {}) {
  autopilotActive = false;
  currentRunId = null;
  lastActivityAt = Date.now();
  clickCount = 0;
  capturedEvents = 0;

  setMode("watching");
  setAgent("dormant", null);
  presenceVerdict.dataset.state = "present";
  presenceVerdict.textContent = "present";

  flashSignal("clicks", "0");
  signals.tab.querySelector(".signal-value").textContent = document.hidden ? "hidden" : "visible";
  captureTicker.textContent = "0 events → L1";
  caret.style.display = "";
  editorCode.innerHTML = "";
  recDot.dataset.on = "false";
  if (!keepCamera) cameraStatus.textContent = stream ? "watching" : "standby";

  clearFeed();
  resetMesh();
  approvalGate.hidden = true;
  finale.hidden = true;
  simulateButton.disabled = false;
}

/* ── wiring ────────────────────────────────────────────────────────── */

window.addEventListener("pointermove", () => markActivity("mouse"), { passive: true });
window.addEventListener(
  "click",
  () => {
    clickCount += 1;
    markActivity("click", { click_count: clickCount });
  },
  { passive: true }
);
window.addEventListener("keydown", (event) => markActivity("keyboard", { key: event.key }), { passive: true });

document.addEventListener("visibilitychange", () => {
  signals.tab.querySelector(".signal-value").textContent = document.hidden ? "hidden" : "visible";
  if (document.hidden && !simulationRunning) startAutopilot("tab_hidden");
});

cameraButton.addEventListener("click", startCamera);
simulateButton.addEventListener("click", runSimulation);
leaveButton.addEventListener("click", () => startAutopilot("manual_leave_button"));
resetButton.addEventListener("click", () => resetWatch());
approveButton.addEventListener("click", () => respondToApproval(true));
declineButton.addEventListener("click", () => respondToApproval(false));

setInterval(() => {
  if (autopilotActive || simulationRunning) return;

  const idleLimitMs = Number(idleSeconds.value) * 1000;
  const remainingMs = Math.max(0, idleLimitMs - (Date.now() - lastActivityAt));
  const ratio = remainingMs / idleLimitMs;

  idleCountdown.textContent = (remainingMs / 1000).toFixed(1);
  idleRingFill.style.strokeDashoffset = String(IDLE_RING_CIRCUMFERENCE * (1 - ratio));
  idleRingFill.dataset.critical = ratio < 0.3 ? "true" : "false";

  if (ratio < 0.35 && ratio > 0) {
    presenceVerdict.dataset.state = "away";
    presenceVerdict.textContent = "going quiet";
  }

  if (remainingMs === 0) startAutopilot("idle_timeout");
}, 100);

setInterval(sampleCameraMotion, 700);

resetWatch();

// Kiosk mode for rehearsals and screenshots: ?autostart=sim replays the whole
// story on load, ?autostart=autopilot jumps straight to the handoff.
const params = new URLSearchParams(location.search);
const autostart = params.get("autostart");
if (params.get("camera") === "1") startCamera();
if (autostart === "sim") setTimeout(runSimulation, 400);
if (autostart === "autopilot") setTimeout(() => startAutopilot("kiosk_autostart"), 400);
