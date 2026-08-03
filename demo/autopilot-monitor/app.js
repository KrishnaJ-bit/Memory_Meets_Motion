const sessionId = `presence-${Date.now()}`;
const taskId = "task-checkout-rate-limit";
const idleCountdown = document.querySelector("#idleCountdown");
const idleSeconds = document.querySelector("#idleSeconds");
const modeBadge = document.querySelector("#modeBadge");
const cameraButton = document.querySelector("#cameraButton");
const leaveButton = document.querySelector("#leaveButton");
const resetButton = document.querySelector("#resetButton");
const cameraFeed = document.querySelector("#cameraFeed");
const cameraProbe = document.querySelector("#cameraProbe");
const cameraStatus = document.querySelector("#cameraStatus");
const mouseStatus = document.querySelector("#mouseStatus");
const clickStatus = document.querySelector("#clickStatus");
const keyStatus = document.querySelector("#keyStatus");
const motionStatus = document.querySelector("#motionStatus");
const timeline = Array.from(document.querySelectorAll("#timeline li"));
const handoffPayload = document.querySelector("#handoffPayload");

let lastActivityAt = Date.now();
let clickCount = 0;
let autopilotActive = false;
let stream;
let previousFrame;

function eventEnvelope(eventType, payload) {
  return {
    session_id: sessionId,
    task_id: taskId,
    event_type: eventType,
    timestamp: new Date().toISOString(),
    payload
  };
}

async function postJson(path, body) {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    return response.ok ? response.json() : undefined;
  } catch {
    return undefined;
  }
}

function updateTimeline(activeIndex) {
  timeline.forEach((item, index) => {
    item.dataset.state = index < activeIndex ? "done" : index === activeIndex ? "active" : "waiting";
  });
}

function markActivity(source, detail = {}) {
  if (autopilotActive) return;

  lastActivityAt = Date.now();
  if (source === "mouse") mouseStatus.textContent = "active";
  if (source === "keyboard") keyStatus.textContent = "active";
  if (source === "click") clickStatus.textContent = String(clickCount);

  postJson("/api/activity-events", eventEnvelope("note", { note_type: "presence_signal", source, ...detail }));
}

function setAutopilot(payload) {
  autopilotActive = true;
  modeBadge.textContent = "Autopilot on";
  modeBadge.dataset.mode = "autopilot";
  updateTimeline(4);
  handoffPayload.textContent = JSON.stringify(payload, null, 2);
}

async function startAutopilot(reason) {
  if (autopilotActive) return;

  updateTimeline(2);
  const payload = eventEnvelope("agent_action", {
    action: "developer_absent",
    reason,
    idle_ms: Date.now() - lastActivityAt,
    handoff: "relay-resume",
    next_pipeline: "relay-resume-pipeline"
  });
  handoffPayload.textContent = JSON.stringify(payload, null, 2);

  updateTimeline(3);
  const result = await postJson("/api/autopilot/start", payload);
  setAutopilot(result ?? payload);
}

async function startCamera() {
  if (stream) return;

  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    cameraFeed.srcObject = stream;
    cameraStatus.textContent = "Camera active";
    markActivity("camera", { state: "permission_granted" });
  } catch (error) {
    cameraStatus.textContent = "Camera unavailable";
    motionStatus.textContent = "off";
    postJson(
      "/api/activity-events",
      eventEnvelope("note", {
        note_type: "presence_signal",
        source: "camera",
        state: "permission_denied",
        error: error instanceof Error ? error.message : String(error)
      })
    );
  }
}

function sampleCameraMotion() {
  if (!stream || cameraFeed.readyState < 2 || autopilotActive) return;

  const context = cameraProbe.getContext("2d", { willReadFrequently: true });
  context.drawImage(cameraFeed, 0, 0, cameraProbe.width, cameraProbe.height);
  const frame = context.getImageData(0, 0, cameraProbe.width, cameraProbe.height).data;

  if (previousFrame) {
    let delta = 0;
    for (let index = 0; index < frame.length; index += 16) {
      delta += Math.abs(frame[index] - previousFrame[index]);
    }
    const motion = delta / (frame.length / 16);
    if (motion > 4) {
      motionStatus.textContent = "present";
      markActivity("camera_motion", { motion: Number(motion.toFixed(2)) });
    } else {
      motionStatus.textContent = "quiet";
    }
  }

  previousFrame = new Uint8ClampedArray(frame);
}

function resetWatch() {
  autopilotActive = false;
  lastActivityAt = Date.now();
  clickCount = 0;
  clickStatus.textContent = "0";
  mouseStatus.textContent = "active";
  keyStatus.textContent = "waiting";
  modeBadge.textContent = "Watching";
  modeBadge.dataset.mode = "watching";
  handoffPayload.textContent = "{}";
  updateTimeline(1);
  markActivity("reset");
}

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
  if (document.hidden) startAutopilot("tab_hidden");
});

cameraButton.addEventListener("click", startCamera);
leaveButton.addEventListener("click", () => startAutopilot("manual_leave_button"));
resetButton.addEventListener("click", resetWatch);

setInterval(() => {
  if (autopilotActive) return;

  const idleLimitMs = Number(idleSeconds.value) * 1000;
  const remainingMs = Math.max(0, idleLimitMs - (Date.now() - lastActivityAt));
  idleCountdown.textContent = (remainingMs / 1000).toFixed(1);
  updateTimeline(remainingMs === 0 ? 2 : 1);

  if (remainingMs === 0) startAutopilot("idle_timeout");
}, 100);

setInterval(sampleCameraMotion, 750);
resetWatch();
