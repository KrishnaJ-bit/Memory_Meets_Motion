import { fileURLToPath } from "node:url";
import type { FalkorGraphClient } from "./types.js";
import { FixtureFalkorClient } from "./fixtureClient.js";

const DEFAULT_FIXTURE_DIR = fileURLToPath(new URL("../../../.falkordb-fixtures/", import.meta.url));

/**
 * `FALKOR_MODE=live` switches every caller in `memory/` to the real FalkorDB SDK with zero other
 * code changes. Defaults to `fixture` because no live FalkorDB endpoint is reachable from this
 * machine (see `execution/CLAUDECODE_1_CAPTURE_MEMORY.md`).
 */
export async function createFalkorClient(): Promise<FalkorGraphClient> {
  const mode = process.env.FALKOR_MODE ?? "fixture";
  if (mode === "live") {
    const { LiveFalkorClient } = await import("./liveClient.js");
    return new LiveFalkorClient();
  }
  if (mode !== "fixture") {
    throw new Error(`Unknown FALKOR_MODE "${mode}", expected "live" or "fixture"`);
  }
  return new FixtureFalkorClient(process.env.FALKOR_FIXTURE_DIR ?? DEFAULT_FIXTURE_DIR);
}
