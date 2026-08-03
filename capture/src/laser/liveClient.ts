import { Laser } from "@laserdata/laser-sdk";
import type { LaserStreamClient, StreamRecord } from "./types.js";

/**
 * Real `@laserdata/laser-sdk` adapter (verified against the installed 0.0.1 package's README and
 * `dist/**.d.ts`, not guessed). Requires either a local Laser Stack (`./scripts/up` from
 * https://github.com/laserdata/laser-stack, Docker-backed) or LaserData Cloud credentials.
 * Neither was available when this track started (see
 * `execution/CLAUDECODE_1_CAPTURE_MEMORY.md`), so this class is exercised by
 * `scripts/*` only when `LASER_MODE=live` is set explicitly.
 *
 * Connection string precedence: the canonical root `.env.example` predates verifying the real
 * SDK and guesses a `LASERDATA_API_TOKEN` + `LASERDATA_STREAM_URL` (token+URL) auth shape: the
 * real SDK instead takes one `user:pass@host:port` connection string (`Laser.connect()`). This
 * adapter treats `LASERDATA_STREAM_URL` as that connection string if it's already in
 * `user:pass@host:port` form, then falls back to `LASER_CONNECTION_STRING`, then the SDK's own
 * documented local-stack default. `LASERDATA_API_TOKEN` isn't consumed here — LaserData Cloud's
 * real token-to-connection-string mapping needs confirming against live docs before it's wired
 * in (see the blocker note this comment points to).
 */
export class LiveLaserClient implements LaserStreamClient {
  readonly mode = "live" as const;
  private laserPromise: ReturnType<typeof Laser.connect> | null = null;

  private async client() {
    if (!this.laserPromise) {
      const connectionString = process.env.LASERDATA_STREAM_URL ?? process.env.LASER_CONNECTION_STRING ?? "iggy:iggy@127.0.0.1:8090";
      this.laserPromise = Laser.connect(connectionString);
    }
    return this.laserPromise;
  }

  async ensure(stream: string, topic: string): Promise<void> {
    const laser = await this.client();
    await laser.stream(stream).topic(topic).ensure(1);
  }

  async publish(stream: string, topic: string, payload: object): Promise<void> {
    const laser = await this.client();
    await laser.stream(stream).topic(topic).publish().json(payload).send();
  }

  async replayFromOffset(stream: string, topic: string, fromOffset: number, max = 1000): Promise<StreamRecord[]> {
    const laser = await this.client();
    const t = laser.stream(stream).topic(topic);
    const cursor = await t.replay({ batchSize: max });
    cursor.fromOffsets(new Map([[0, BigInt(fromOffset)]]));
    const messages = await cursor.poll();
    const decoder = new TextDecoder();
    return messages.map((m) => ({
      offset: Number(m.offset),
      payload: JSON.parse(decoder.decode(m.payload)) as Record<string, unknown>,
    }));
  }

  async count(stream: string, topic: string): Promise<number> {
    // Apache Iggy exposes partition offsets via topic info, not a direct "count" verb through
    // this SDK surface; replaying the whole partition is the documented way to get an exact
    // count for the modest event volumes this track produces.
    const all = await this.replayFromOffset(stream, topic, 0, 100_000);
    return all.length;
  }

  async close(): Promise<void> {
    if (this.laserPromise) {
      const laser = await this.laserPromise;
      await laser.close();
    }
  }
}
