// G3 entry point — fired by the github.pr.opened trigger, or manually against a
// PR number for the demo rehearsal.
//
//   npm run tsx src/run_review.ts -- --task <task_id> --pr 42

import { prRiskReview } from './guild/agents.js';
import { invokeAgent } from './guild/runner.js';
import { arg } from './cli.js';

async function main(): Promise<void> {
	const taskId = arg('task') ?? 'demo-task';
	const pr = Number(arg('pr'));

	if (!Number.isFinite(pr)) {
		console.error('Usage: tsx src/run_review.ts --task <task_id> --pr <number>');
		process.exitCode = 2;
		return;
	}

	const outcome = await invokeAgent(prRiskReview, {
		taskId,
		trigger: { kind: 'webhook-event', event: 'github.pr.opened', payload: { pull_request_number: pr } },
	});

	console.log('\n--- G3 result ---');
	console.log(JSON.stringify(outcome, null, 2));
	if (outcome.status === 'failed') process.exitCode = 1;
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
