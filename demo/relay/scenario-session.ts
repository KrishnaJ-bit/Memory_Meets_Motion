/**
 * The frozen demo session, expressed in the canonical L1 vocabulary.
 *
 * `demo/fixture-events.jsonl` (Codex) tells the right story but uses free-form
 * note payloads, and `capture/src/simulator.ts` (Track 1) emits the right shape
 * but generic content. Neither alone puts the checkout rate-limit arc into the
 * graph. This module is the bridge: the scripted arc from `demo/scenario.json`,
 * emitted with the `note.kind` discriminators `memory/src/consumer.ts` dispatches
 * on, so the live FalkorDB graph actually tells the story the demo narrates.
 *
 * The blocker is deliberately left OPEN — the developer walks away mid-task, and
 * an open Blocker node is exactly what the resume agent has to inherit.
 */

import type { DevSessionEvent } from '../../src/shared/envelope.js';

export const DEMO_TASK_ID = 'task-checkout-rate-limit';
export const DEMO_BLOCKER_ID = 'blocker-refill-boundary';
export const DEMO_TARGET_FILE = 'demo/toy-repo/src/rateLimit.js';

export interface ScenarioOptions {
	readonly sessionId?: string;
	readonly startTime?: Date;
}

/**
 * Builds the scripted developer session: sliding-window attempt, the switch to
 * token-bucket and why, then the boundary test failing at exactly 1000 ms.
 */
export function buildScenarioSession(options: ScenarioOptions = {}): DevSessionEvent[] {
	const sessionId = options.sessionId ?? `session-demo-checkout-${Date.now()}`;
	let clock = (options.startTime ?? new Date(Date.now() - 25 * 60 * 1000)).getTime();

	const at = (seconds: number): string => {
		clock += seconds * 1000;
		return new Date(clock).toISOString();
	};

	const events: DevSessionEvent[] = [];
	const push = (event_type: DevSessionEvent['event_type'], seconds: number, payload: Record<string, unknown>) => {
		events.push({ session_id: sessionId, task_id: DEMO_TASK_ID, event_type, timestamp: at(seconds), payload });
	};

	push('note', 0, {
		kind: 'task_started',
		title: 'Add token-bucket rate limiting to /api/checkout',
	});

	// Step 1 — inspect the route, confirm the baseline is green.
	push('note', 5, { kind: 'step_started', step_id: 'step_1', order: 0, description: 'inspect /api/checkout and confirm a green baseline' });
	push('terminal_cmd', 20, { step_id: 'step_1', command: 'npm test --prefix demo/toy-repo', exit_code: 0 });
	push('file_save', 15, { step_id: 'step_1', path: 'demo/toy-repo/src/checkout.js' });
	push('note', 5, { kind: 'step_completed', step_id: 'step_1', description: 'baseline green before limiter work' });

	// Step 2 — the sliding-window attempt that gets abandoned.
	push('note', 10, { kind: 'step_started', step_id: 'step_2', order: 1, description: 'draft a sliding-window limiter' });
	push('file_save', 90, { step_id: 'step_2', path: DEMO_TARGET_FILE });
	push('diff', 30, { step_id: 'step_2', path: DEMO_TARGET_FILE, lines_changed: 48 });
	push('note', 20, {
		kind: 'decision',
		step_id: 'step_2',
		text: 'abandon the sliding-window limiter',
		reasoning:
			'it keeps a per-user timestamp list, so memory grows with traffic and the demo service does not need that precision',
	});
	push('note', 5, { kind: 'step_completed', step_id: 'step_2', description: 'sliding-window abandoned' });

	// Step 3 — token bucket, the approach that sticks.
	push('note', 10, { kind: 'step_started', step_id: 'step_3', order: 2, description: 'switch to a token-bucket limiter' });
	push('note', 15, {
		kind: 'decision',
		step_id: 'step_3',
		text: 'use a token bucket with capacity 2 and refill 1 request/second',
		reasoning: 'constant memory per user, and the refill rate maps directly onto the checkout rate we want to advertise',
	});
	push('file_save', 120, { step_id: 'step_3', path: DEMO_TARGET_FILE });
	push('diff', 25, { step_id: 'step_3', path: DEMO_TARGET_FILE, lines_changed: 34 });
	push('file_save', 40, { step_id: 'step_3', path: 'demo/toy-repo/test/checkout.test.js' });
	push('note', 5, { kind: 'step_completed', step_id: 'step_3', description: 'token-bucket limiter wired into the checkout handler' });

	// Step 4 — the boundary test fails, and the developer leaves.
	push('note', 10, { kind: 'step_started', step_id: 'step_4', order: 3, description: 'run the suite and fix the boundary case' });
	push('terminal_cmd', 30, { step_id: 'step_4', command: 'npm test --prefix demo/toy-repo', exit_code: 1 });
	// Ties the open blocker to the file that carries the bug, so F3 hands the
	// resume agent the filename instead of making it guess.
	push('file_save', 10, { step_id: 'step_4', path: DEMO_TARGET_FILE });
	push('note', 15, {
		kind: 'blocker_encountered',
		step_id: 'step_4',
		blocker_id: DEMO_BLOCKER_ID,
		description:
			'the boundary test fails: at exactly 1000 ms the bucket does not refill, so the third request is rejected with 429 instead of 200',
	});
	push('note', 20, {
		kind: 'decision',
		step_id: 'step_4',
		text: 'the refill comparison is the suspect, not the capacity',
		reasoning:
			'two requests are consumed correctly and only the exact-boundary case fails, which points at a strict elapsed-time comparison rather than the bucket maths',
	});
	push('terminal_cmd', 45, { step_id: 'step_4', command: 'git diff --stat', exit_code: 0 });

	// No step_completed, no blocker_resolved, no task_completed: the developer walked away.
	return events;
}
