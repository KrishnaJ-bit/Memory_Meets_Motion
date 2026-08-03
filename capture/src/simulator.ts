import { randomUUID } from "node:crypto";
import type { DevSessionEvent, L1EventType } from "../../src/shared/envelope.js";

export interface SimulatorOptions {
  readonly sessionId?: string;
  readonly taskId?: string;
  readonly taskTitle?: string;
  readonly stepCount?: number;
  /** Deterministic pseudo-random seed so fixtures are reproducible across runs. */
  readonly seed?: number;
  readonly startTime?: Date;
  /** If true, the session's blocker is never resolved — leaves a real F3 (open blocker) sample. */
  readonly leaveBlockerOpen?: boolean;
}

const STEP_DESCRIPTIONS = [
  "read repo docs",
  "reproduce the bug",
  "write failing test",
  "implement fix",
  "run test suite",
  "refactor for clarity",
  "update docs",
  "review diff",
];

const DECISIONS = [
  { text: "use MERGE instead of CREATE for graph writes", reasoning: "replay safety on consumer restart" },
  { text: "isolate each task in its own FalkorDB graph", reasoning: "avoids cross-task query bleed (F5)" },
  { text: "mirror graph writes to LaserData L2", reasoning: "gives Codex/RocketRide an audit trail without querying the graph directly" },
];

const BLOCKER_DESCRIPTIONS = [
  "FalkorDB Cloud requires an API key we don't have",
  "Docker is not installed on this host",
  "LaserData SDK requires Node >=22.14",
];

const COMMANDS = ["npm test", "npm run typecheck", "git diff --stat", "npm run seed-graph"];

function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generates a realistic, reproducible sequence of L1 (`dev.session.events`) events for one task,
 * using the 4 wire event types from `EXECUTION.md` Section 2 (`file_save | terminal_cmd | diff |
 * note`) — task/step lifecycle, decisions, and blockers all ride on `note` with a `kind`
 * discriminator (see `src/shared/envelope.ts`). Always emits at least 15 events for stepCount >= 3.
 */
export function simulateSession(options: SimulatorOptions = {}): DevSessionEvent[] {
  const sessionId = options.sessionId ?? `sess_${randomUUID().slice(0, 8)}`;
  const taskId = options.taskId ?? `task_${randomUUID().slice(0, 8)}`;
  const taskTitle = options.taskTitle ?? "Build capture + memory layer for Relay";
  const stepCount = options.stepCount ?? 4;
  const rand = mulberry32(options.seed ?? 42);
  let clock = (options.startTime ?? new Date()).getTime();

  const events: DevSessionEvent[] = [];
  const tick = (seconds: number) => {
    clock += seconds * 1000;
    return new Date(clock).toISOString();
  };
  const push = (event_type: L1EventType, payload: Record<string, unknown>) => {
    events.push({ session_id: sessionId, task_id: taskId, event_type, timestamp: tick(1 + Math.floor(rand() * 20)), payload });
  };

  push("note", { kind: "task_started", title: taskTitle });

  for (let i = 0; i < stepCount; i++) {
    const stepId = `step_${i + 1}`;
    const description = STEP_DESCRIPTIONS[i % STEP_DESCRIPTIONS.length]!;
    push("note", { kind: "step_started", step_id: stepId, description, order: i });

    if (i === 1) {
      const decision = DECISIONS[0]!;
      push("note", { kind: "decision", step_id: stepId, ...decision });
    }
    if (i === 2) {
      const blockerId = `blocker_${i + 1}`;
      const description = BLOCKER_DESCRIPTIONS[i % BLOCKER_DESCRIPTIONS.length]!;
      push("note", { kind: "blocker_encountered", step_id: stepId, blocker_id: blockerId, description });
      // Decision made resolving the blocker above, on the same step — this is exactly the
      // decision -> step -> blocker join F4 (similar past-resolved blocker lookup) traverses.
      push("note", { kind: "decision", step_id: stepId, text: "pin to the installed Node version instead of upgrading immediately", reasoning: "the LaserData SDK's newer Node requirement isn't worth blocking the whole task over" });
      if (!options.leaveBlockerOpen) {
        push("note", { kind: "blocker_resolved", step_id: stepId, blocker_id: blockerId });
      }
    }

    push("file_save", { step_id: stepId, path: `capture/src/${description.replace(/\s+/g, "_")}.ts` });
    push("diff", { step_id: stepId, path: `capture/src/${description.replace(/\s+/g, "_")}.ts`, lines_changed: 5 + Math.floor(rand() * 80) });
    push("terminal_cmd", { step_id: stepId, command: COMMANDS[i % COMMANDS.length], exit_code: 0 });

    if (i === stepCount - 2) {
      push("terminal_cmd", { step_id: stepId, command: "npm test", exit_code: 0 });
    }

    push("note", { kind: "step_completed", step_id: stepId, description });
  }

  push("note", { kind: "task_completed", title: taskTitle });

  return events;
}
