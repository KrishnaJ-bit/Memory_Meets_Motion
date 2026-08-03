#!/usr/bin/env -S npx tsx
/**
 * Builds the stable fixture package under `fixtures/` for Track 2 (Codex) and Track 3
 * (RocketRide) to integrate against, per the Handoff Contract in
 * `execution/CLAUDECODE_1_CAPTURE_MEMORY.md`. Uses a throwaway fixture store (not the working
 * `.laserdata-fixtures` / `.falkordb-fixtures` dirs) so this is reproducible independent of
 * whatever local dev state exists.
 */
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { simulateSession } from "../capture/src/simulator.js";
import { FixtureLaserClient } from "../capture/src/laser/fixtureClient.js";
import { L1_STREAM, L1_TOPIC, L2_STREAM, L2_TOPIC } from "../capture/src/laser/client.js";
import { consumeL1ToGraph } from "../memory/src/consumer.js";

const FIXTURES_DIR = path.join(process.cwd(), "fixtures");
const TMP_LASER_DIR = path.join(process.cwd(), ".fixture-build", "laser");
const TMP_FALKOR_DIR = path.join(process.cwd(), ".fixture-build", "falkor");

async function main() {
  await rm(path.join(process.cwd(), ".fixture-build"), { recursive: true, force: true });
  await mkdir(TMP_LASER_DIR, { recursive: true });
  await mkdir(TMP_FALKOR_DIR, { recursive: true });
  process.env.LASER_MODE = "fixture";
  process.env.LASER_FIXTURE_DIR = TMP_LASER_DIR + "/";
  process.env.FALKOR_MODE = "fixture";
  process.env.FALKOR_FIXTURE_DIR = TMP_FALKOR_DIR + "/";

  const taskId = "demo-task";
  // leaveBlockerOpen so fixtures/f3_sample_blocker_lookup.json has a real (non-empty) sample —
  // F3 only returns *unresolved* blockers.
  const events = simulateSession({ taskId, sessionId: "demo-session", seed: 7, startTime: new Date("2026-08-03T17:00:00.000Z"), leaveBlockerOpen: true });

  const laser = new FixtureLaserClient(TMP_LASER_DIR + "/");
  await laser.ensure(L1_STREAM, L1_TOPIC);
  for (const event of events) await laser.publish(L1_STREAM, L1_TOPIC, event);

  await mkdir(FIXTURES_DIR, { recursive: true });
  await writeFile(path.join(FIXTURES_DIR, "l1_dev_session_events.json"), JSON.stringify(events, null, 2));
  console.log(`wrote fixtures/l1_dev_session_events.json (${events.length} events, task_id=${taskId})`);

  const summary = await consumeL1ToGraph(0);
  console.log(`seeded graph: ${JSON.stringify(summary)}`);

  const { reconstructContext } = await import("../memory/src/queries/f2.js");
  const { lookupOpenBlockers } = await import("../memory/src/queries/f3.js");
  const f2 = await reconstructContext(taskId);
  const f3 = await lookupOpenBlockers(taskId);
  await writeFile(path.join(FIXTURES_DIR, "f2_sample_context.json"), JSON.stringify(f2, null, 2));
  await writeFile(path.join(FIXTURES_DIR, "f3_sample_blocker_lookup.json"), JSON.stringify(f3, null, 2));
  console.log("wrote fixtures/f2_sample_context.json, fixtures/f3_sample_blocker_lookup.json");

  const l2 = await laser.replayFromOffset(L2_STREAM, L2_TOPIC, 0, 1000);
  await writeFile(path.join(FIXTURES_DIR, "l2_graph_mutations_sample.json"), JSON.stringify(l2, null, 2));
  console.log(`wrote fixtures/l2_graph_mutations_sample.json (${l2.length} mutation records)`);

  await rm(path.join(process.cwd(), ".fixture-build"), { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
