/**
 * The event envelope every capture producer and consumer in Relay agrees on — defined in the
 * root `EXECUTION.md` Section 2 ("all streams"). This is the contract other tracks (Guild.ai via
 * G1/G2, RocketRide via R1/R2) integrate against.
 *
 * `event_type` is deliberately coarse (4 values used on L1, 1 reserved for L2, 1 for L3) so the
 * envelope stays identical across LaserData streams. L1 (`dev.session.events`) uses
 * `file_save | terminal_cmd | diff | note`; the memory-layer consumer derives the richer
 * Task/Step/Decision/File/Blocker graph shape from these four plus each `note` payload's `kind`
 * discriminator. `graph_write` is L2's event_type (produced by the consumer, never by the
 * simulator) and `agent_action` is Track 2's L3 event_type — declared here for completeness
 * since the envelope type is shared, not owned per-stream.
 */

export const EVENT_TYPES = ["file_save", "terminal_cmd", "diff", "note", "graph_write", "agent_action"] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/** event_type values the L1 session simulator (Track 1) actually emits. */
export const L1_EVENT_TYPES = ["file_save", "terminal_cmd", "diff", "note"] as const;
export type L1EventType = (typeof L1_EVENT_TYPES)[number];

export interface DevSessionEvent<Payload extends Record<string, unknown> = Record<string, unknown>> {
  readonly session_id: string;
  readonly task_id: string;
  readonly event_type: EventType;
  /** ISO-8601 UTC timestamp. */
  readonly timestamp: string;
  readonly payload: Payload;
}

/**
 * `note` events carry a `kind` discriminator so 4 wire event types can express a full session
 * lifecycle (task/step boundaries, decisions, blockers) without widening `EventType`.
 */
export const NOTE_KINDS = [
  "task_started",
  "task_completed",
  "step_started",
  "step_completed",
  "decision",
  "blocker_encountered",
  "blocker_resolved",
] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export interface FileSavePayload extends Record<string, unknown> {
  readonly step_id: string;
  readonly path: string;
}

export interface DiffPayload extends Record<string, unknown> {
  readonly step_id: string;
  readonly path: string;
  readonly lines_changed: number;
}

export interface TerminalCmdPayload extends Record<string, unknown> {
  readonly step_id: string;
  readonly command: string;
  readonly exit_code: number;
}

export interface NotePayload extends Record<string, unknown> {
  readonly kind: NoteKind;
  readonly step_id?: string;
  readonly title?: string; // task_started / task_completed
  readonly description?: string; // step_started / step_completed
  readonly order?: number; // step_started
  readonly text?: string; // decision
  readonly reasoning?: string; // decision
  readonly blocker_id?: string; // blocker_encountered / blocker_resolved
}

export class EnvelopeValidationError extends TypeError {}

export function assertDevSessionEvent(value: unknown): asserts value is DevSessionEvent {
  if (typeof value !== "object" || value === null) {
    throw new EnvelopeValidationError("event must be an object");
  }
  const event = value as Record<string, unknown>;
  for (const field of ["session_id", "task_id", "event_type", "timestamp"] as const) {
    if (typeof event[field] !== "string" || event[field] === "") {
      throw new EnvelopeValidationError(`event.${field} must be a non-empty string`);
    }
  }
  if (!EVENT_TYPES.includes(event.event_type as EventType)) {
    throw new EnvelopeValidationError(`event.event_type "${String(event.event_type)}" is not a known EventType`);
  }
  if (Number.isNaN(Date.parse(event.timestamp as string))) {
    throw new EnvelopeValidationError("event.timestamp must be a parseable ISO-8601 timestamp");
  }
  if (typeof event.payload !== "object" || event.payload === null || Array.isArray(event.payload)) {
    throw new EnvelopeValidationError("event.payload must be an object");
  }
}

export function parseDevSessionEvent(raw: string): DevSessionEvent {
  const value = JSON.parse(raw);
  assertDevSessionEvent(value);
  return value;
}
