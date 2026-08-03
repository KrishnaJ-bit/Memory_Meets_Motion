export interface StreamRecord {
  readonly offset: number;
  readonly payload: Record<string, unknown>;
}

/**
 * Adapter boundary between capture/memory code and LaserData. Both the live SDK adapter and the
 * local fixture adapter implement this so callers never branch on which one is active.
 */
export interface LaserStreamClient {
  readonly mode: "live" | "fixture";
  /** Idempotent: creates the stream/topic if missing, no-ops if it already exists. */
  ensure(stream: string, topic: string): Promise<void>;
  publish(stream: string, topic: string, payload: object): Promise<void>;
  replayFromOffset(stream: string, topic: string, fromOffset: number, max?: number): Promise<StreamRecord[]>;
  count(stream: string, topic: string): Promise<number>;
  close(): Promise<void>;
}
