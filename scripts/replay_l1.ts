#!/usr/bin/env -S npx tsx
import { createLaserClient, L1_STREAM, L1_TOPIC } from "../capture/src/laser/client.js";

async function main() {
  const fromOffset = process.argv[2] ? Number(process.argv[2]) : 0;

  const client = await createLaserClient();
  const records = await client.replayFromOffset(L1_STREAM, L1_TOPIC, fromOffset);
  const total = await client.count(L1_STREAM, L1_TOPIC);
  await client.close();

  console.log(`[laser:${client.mode}] replay ${L1_STREAM}/${L1_TOPIC} from offset ${fromOffset}`);
  console.log(`[laser:${client.mode}] got ${records.length} record(s), stream total = ${total}`);
  for (const record of records) {
    console.log(JSON.stringify(record));
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
