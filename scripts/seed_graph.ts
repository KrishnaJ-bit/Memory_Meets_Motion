#!/usr/bin/env -S npx tsx
import { consumeL1ToGraph } from "../memory/src/consumer.js";

async function main() {
  const fromOffset = process.argv[2] ? Number(process.argv[2]) : 0;
  const summary = await consumeL1ToGraph(fromOffset);
  console.log(`processed ${summary.eventsProcessed} L1 event(s) from offset ${fromOffset}`);
  console.log(`applied ${summary.mutationsApplied} graph mutation(s) (mirrored to relay.graph.mutations)`);
  console.log(`graphs touched: ${summary.graphsTouched.join(", ") || "(none)"}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
