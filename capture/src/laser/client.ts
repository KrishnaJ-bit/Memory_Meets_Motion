import type { LaserStreamClient } from "./types.js";
import { FixtureLaserClient } from "./fixtureClient.js";

const DEFAULT_FIXTURE_DIR = new URL("../../../.laserdata-fixtures/", import.meta.url).pathname;

/**
 * `LASER_MODE=live` switches every caller in `capture/` and `memory/` to the real LaserData SDK
 * with zero other code changes. Defaults to `fixture` because no live LaserData endpoint is
 * reachable from this machine (see `execution/CLAUDECODE_1_CAPTURE_MEMORY.md`).
 */
export async function createLaserClient(): Promise<LaserStreamClient> {
  const mode = process.env.LASER_MODE ?? "fixture";
  if (mode === "live") {
    const { LiveLaserClient } = await import("./liveClient.js");
    return new LiveLaserClient();
  }
  if (mode !== "fixture") {
    throw new Error(`Unknown LASER_MODE "${mode}", expected "live" or "fixture"`);
  }
  return new FixtureLaserClient(process.env.LASER_FIXTURE_DIR ?? DEFAULT_FIXTURE_DIR);
}

export const L1_STREAM = "dev.session.events";
export const L1_TOPIC = "sessions";
export const L2_STREAM = "relay.graph.mutations";
export const L2_TOPIC = "mutations";
