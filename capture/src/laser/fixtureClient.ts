import { mkdir, appendFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { LaserStreamClient, StreamRecord } from "./types.js";

/**
 * Documented fallback for LaserData: this machine has no container runtime and no LaserData
 * Cloud credentials, so a live Apache Iggy connection isn't reachable (see
 * `execution/CLAUDECODE_1_CAPTURE_MEMORY.md` for the blocker note). This adapter implements the
 * exact same `LaserStreamClient` interface as `liveClient.ts` over a durable, append-only JSONL
 * file per stream/topic pair, so every caller is a one-line env var away from the live SDK once
 * either Docker or LaserData Cloud credentials are available.
 *
 * Each line is one record: `{"offset": number, "payload": object}`. The offset is the 0-based
 * line index, matching Iggy's own zero-based partition offsets.
 */
export class FixtureLaserClient implements LaserStreamClient {
  readonly mode = "fixture" as const;

  constructor(private readonly baseDir: string) {}

  private filePath(stream: string, topic: string): string {
    return path.join(this.baseDir, `${stream}__${topic}.jsonl`);
  }

  async ensure(stream: string, topic: string): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
    const file = this.filePath(stream, topic);
    if (!existsSync(file)) {
      await appendFile(file, "");
    }
  }

  async publish(stream: string, topic: string, payload: object): Promise<void> {
    await this.ensure(stream, topic);
    const offset = await this.count(stream, topic);
    const line = JSON.stringify({ offset, payload });
    await appendFile(this.filePath(stream, topic), line + "\n");
  }

  private async readAll(stream: string, topic: string): Promise<StreamRecord[]> {
    const file = this.filePath(stream, topic);
    if (!existsSync(file)) return [];
    const raw = await readFile(file, "utf8");
    return raw
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as StreamRecord);
  }

  async replayFromOffset(stream: string, topic: string, fromOffset: number, max = 1000): Promise<StreamRecord[]> {
    const all = await this.readAll(stream, topic);
    return all.filter((r) => r.offset >= fromOffset).slice(0, max);
  }

  async count(stream: string, topic: string): Promise<number> {
    return (await this.readAll(stream, topic)).length;
  }

  async close(): Promise<void> {
    // no-op: file handles are opened/closed per call
  }
}
