#!/usr/bin/env -S npx tsx
import { simulateSession } from "../capture/src/simulator.js";
import { assertDevSessionEvent } from "../src/shared/envelope.js";
import { createLaserClient, L1_STREAM, L1_TOPIC } from "../capture/src/laser/client.js";

async function main() {
  const taskId = process.argv[2] ?? undefined;
  const seed = process.argv[3] ? Number(process.argv[3]) : undefined;

  const events = simulateSession(taskId ? { taskId, seed } : { seed });
  events.forEach(assertDevSessionEvent);

  const client = await createLaserClient();
  await client.ensure(L1_STREAM, L1_TOPIC);
  for (const event of events) {
    await client.publish(L1_STREAM, L1_TOPIC, event);
  }
  const total = await client.count(L1_STREAM, L1_TOPIC);
  await client.close();

  console.log(`[laser:${client.mode}] published ${events.length} events to ${L1_STREAM}/${L1_TOPIC}`);
  console.log(`[laser:${client.mode}] stream now has ${total} total event(s)`);
  console.log(`session_id=${events[0]!.session_id} task_id=${events[0]!.task_id}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
