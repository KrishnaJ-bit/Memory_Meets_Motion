// No camera. Presence is mouse, click, keyboard, and tab visibility only —
// same trigger, no privacy objection, one less integration to keep working.

const sessionId = `presence-${Date.now()}`;
const taskId = "task-checkout-rate-limit";

const modeBadge = document.querySelector("#modeBadge");
const modeBadgeText = document.querySelector("#modeBadgeText");
const idleCountdown = document.querySelector("#idleCountdown");
const idleBarFill = document.querySelector("#idleBarFill");
const idleSeconds = document.querySelector("#idleSeconds");
const mouseStatus = document.querySelector("#mouseStatus");
const clickStatus = document.querySelector("#clickStatus");
const keyStatus = document.querySelector("#keyStatus");
const tabStatus = document.querySelector("#tabStatus");
const leaveButton = document.querySelector("#leaveButton");
const resetButton = document.querySelector("#resetButton");
const feed = document.querySelector("#feed");
const approvalGate = document.querySelector("#approvalGate");
const approveButton = document.querySelector("#approveButton");
const declineButton = document.querySelector("#declineButton");
const finale = document.querySelector("#finale");
const finaleEyebrow = document.querySelector("#finaleEyebrow");
const finaleLink = document.querySelector("#finaleLink");
const finaleSub = document.querySelector("#finaleSub");

let lastActivityAt = Date.now();
let clickCount = 0;
let autopilotActive = false;
let currentRunId = null;

function eventEnvelope(eventType, payload) {
  return { session_id: sessionId, task_id: taskId, event_type: eventType, timestamp: new Date().toISOString(), payload };
}

function postJson(path, body) {
  fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => undefined);
}

function markActivity(source, detail = {}) {
  if (autopilotActive) return;
  lastActivityAt = Date.now();
  if (source === "mouse") mouseStatus.textContent = "active";
  if (source === "keyboard") keyStatus.textContent = "active";
  if (source === "click") clickStatus.textContent = String(clickCount);
  postJson("/api/activity-events", eventEnvelope("note", { note_type: "presence_signal", source, ...detail }));
}

function setMode(mode) {
  modeBadge.dataset.mode = mode;
  modeBadgeText.textContent = mode === "autopilot" ? "Autopilot on" : "Watching";
}

const STATUS_ICON = { live: "●", degraded: "◐", skipped: "○", failed: "✕" };

function addFeedItem(stage) {
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
  li.scrollIntoView({ behavior: "smooth", block: "end" });
  return li;
}

function clearFeed() {
  feed.innerHTML = "";
}

function openStream(path, handlers) {
  const source = new EventSource(path);
  for (const [event, handler] of Object.entries(handlers)) {
    source.addEventListener(event, (message) => handler(JSON.parse(message.data), source));
  }
  source.onerror = () => {
    // A clean `.close()` after "done"/"ready" also fires error in some browsers;
    // only surface it if the stream is still meant to be open.
  };
  return source;
}

async function startAutopilot(reason) {
  if (autopilotActive) return;
  autopilotActive = true;
  setMode("autopilot");
  clearFeed();
  approvalGate.hidden = true;
  finale.hidden = true;

  postJson(
    "/api/activity-events",
    eventEnvelope("agent_action", { action: "developer_absent", reason, idle_ms: Date.now() - lastActivityAt, handoff: "relay-resume" })
  );

  openStream(`/api/autopilot/prepare-stream?task_id=${encodeURIComponent(taskId)}&offset=0`, {
    run_id: (payload) => {
      currentRunId = payload.run_id;
    },
    stage: (stage) => {
      addFeedItem(stage);
      if (stage.name === "awaiting_human_approval") {
        approvalGate.hidden = false;
      }
    },
    ready: () => {
      // Stages already streamed one at a time above; nothing else to do here
      // unless tests never passed (no awaiting_human_approval stage fired).
    },
    error: (payload) => {
      addFeedItem({ name: "stream_error", status: "failed", detail: payload.message });
    }
  });
}

function respondToApproval(approved) {
  if (!currentRunId) return;
  approvalGate.hidden = true;

  openStream(`/api/autopilot/approve-stream?run_id=${encodeURIComponent(currentRunId)}&approved=${approved}`, {
    stage: (stage) => addFeedItem(stage),
    done: (result) => {
      finale.hidden = false;
      if (result.prUrl) {
        finaleEyebrow.textContent = "Autopilot finished — pull request open";
        finaleLink.href = result.prUrl;
        finaleLink.textContent = result.prUrl;
        finaleSub.textContent = `${result.attempts} test attempt(s) · graph ${result.graph} · ${result.l3Records} L3 record(s)`;
      } else {
        finaleEyebrow.textContent = approved ? "Approved, but no PR opened" : "Declined — no PR opened";
        finaleLink.removeAttribute("href");
        finaleLink.textContent = "";
        finaleSub.textContent = result.testsPassed
          ? "Tests passed but the PR step was skipped (see the feed above for why)."
          : `Tests never passed after ${result.attempts} attempt(s) — nothing to approve.`;
      }
    },
    error: (payload) => addFeedItem({ name: "stream_error", status: "failed", detail: payload.message })
  });
}

function resetWatch() {
  autopilotActive = false;
  currentRunId = null;
  lastActivityAt = Date.now();
  clickCount = 0;
  clickStatus.textContent = "0";
  mouseStatus.textContent = "active";
  keyStatus.textContent = "waiting";
  tabStatus.textContent = "visible";
  setMode("watching");
  clearFeed();
  approvalGate.hidden = true;
  finale.hidden = true;
  markActivity("reset");
}

window.addEventListener("pointermove", () => markActivity("mouse"), { passive: true });
window.addEventListener("click", () => { clickCount += 1; markActivity("click", { click_count: clickCount }); }, { passive: true });
window.addEventListener("keydown", (event) => markActivity("keyboard", { key: event.key }), { passive: true });
document.addEventListener("visibilitychange", () => {
  tabStatus.textContent = document.hidden ? "hidden" : "visible";
  if (document.hidden) startAutopilot("tab_hidden");
});

leaveButton.addEventListener("click", () => startAutopilot("manual_leave_button"));
resetButton.addEventListener("click", resetWatch);
approveButton.addEventListener("click", () => respondToApproval(true));
declineButton.addEventListener("click", () => respondToApproval(false));

setInterval(() => {
  if (autopilotActive) return;
  const idleLimitMs = Number(idleSeconds.value) * 1000;
  const remainingMs = Math.max(0, idleLimitMs - (Date.now() - lastActivityAt));
  idleCountdown.textContent = (remainingMs / 1000).toFixed(1);
  idleBarFill.style.width = `${(remainingMs / idleLimitMs) * 100}%`;
  if (remainingMs === 0) startAutopilot("idle_timeout");
}, 100);

resetWatch();
