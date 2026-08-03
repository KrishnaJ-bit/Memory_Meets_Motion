// G1 entry point — run the capture/summarization agent once.
//
//   npm run capture -- --task <task_id> --offset <l1_offset>

import { contextSummarizer } from './guild/agents.js';
import { invokeAgent } from './guild/runner.js';
import { arg } from './cli.js';

async function main(): Promise<void> {
	const taskId = arg('task') ?? 'demo-task';
	const offset = Number(arg('offset') ?? '0');

	const outcome = await invokeAgent(contextSummarizer, {
		taskId,
		trigger: { kind: 'on-batch', payload: { offset } },
	});

	console.log('\n--- G1 result ---');
	console.log(JSON.stringify(outcome, null, 2));
	if (outcome.status === 'failed') process.exitCode = 1;
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
