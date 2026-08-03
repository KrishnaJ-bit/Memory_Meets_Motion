// G2 entry point — the demo's manual trigger.
//
//   npm run resume -- --task <task_id> --goal "add rate limiting to /api/checkout" \
//                     --offset <l1_offset> [--idle]
//
// `--idle` records the run as the idle-timeout trigger instead of the manual
// button, so both trigger types can be demonstrated from the same code path.

import { relayResume } from './guild/agents.js';
import { invokeAgent } from './guild/runner.js';
import { arg, flag } from './cli.js';

async function main(): Promise<void> {
	const taskId = arg('task') ?? 'demo-task';
	const goal = arg('goal') ?? 'Finish the interrupted task.';
	const offset = arg('offset') ?? '0';
	const idle = flag('idle');

	const outcome = await invokeAgent(relayResume, {
		taskId,
		trigger: {
			kind: idle ? 'idle-timeout' : 'manual',
			payload: { goal, replay_offset: Number.isNaN(Number(offset)) ? offset : Number(offset) },
		},
	});

	console.log('\n--- G2 result ---');
	console.log(JSON.stringify(outcome, null, 2));
	if (outcome.status === 'failed') process.exitCode = 1;
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
