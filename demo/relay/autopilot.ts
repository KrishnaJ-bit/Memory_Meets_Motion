/**
 * The autopilot run: what happens after the presence monitor decides the
 * developer has left.
 *
 * This is the seam between all three tracks:
 *   LaserData  — replay the L1 tail from an offset, publish L3 agent actions
 *   FalkorDB   — F2/F3 context reconstruction, then F6 agent write-back
 *   RocketRide — R2 does the reasoning + code edit, when credentials exist
 *   Guild.ai   — the run is invoked as the governed `relay-resume` agent
 *
 * Honesty rule: every stage reports whether it ran live or degraded, and the
 * degraded paths are named in the output. Nothing here claims a sponsor ran when
 * it did not. `npm test` in the toy repo is always executed for real — the demo
 * never asserts a passing test it did not observe.
 */

import { execFile } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { createLaserClient } from '../../capture/src/laser/client.js';
import { createFalkorClient } from '../../memory/src/falkor/client.js';
import { lookupOpenBlockers } from '../../memory/src/queries/f3.js';
import { reconstructContext } from '../../memory/src/queries/f2.js';
import { graphNameForTask } from '../../src/shared/graph-contract.js';
import type { DevSessionEvent } from '../../src/shared/envelope.js';
import { DEMO_BLOCKER_ID, DEMO_TASK_ID, DEMO_TARGET_FILE } from './scenario-session.js';

const execFileAsync = promisify(execFile);

export const L3_STREAM = 'relay.agent.actions';
export const L3_TOPIC = 'actions';
export const L1_STREAM = 'dev.session.events';
export const L1_TOPIC = 'sessions';

const REPO_ROOT = resolve(new URL('../../', import.meta.url).pathname);
const AGENT_ID = 'relay-resume';

export type StageStatus = 'live' | 'degraded' | 'skipped' | 'failed';

export interface Stage {
	name: string;
	status: StageStatus;
	detail: string;
	data?: unknown;
}

export interface AutopilotResult {
	taskId: string;
	sessionId: string;
	startedAt: string;
	endedAt: string;
	stages: Stage[];
	testsPassed: boolean;
	attempts: number;
	patchApplied: boolean;
	graph: string;
	l3Records: number;
}

export interface AutopilotOptions {
	taskId?: string;
	sessionId?: string;
	/** L1 offset the resume context is rebuilt from. */
	replayOffset?: number;
	/** Emit progress lines as the run proceeds. */
	onProgress?: (stage: Stage) => void;
}

/** Run the toy repo's real test suite and report what actually happened. */
async function runTests(): Promise<{ passed: boolean; output: string }> {
	try {
		const { stdout, stderr } = await execFileAsync('npm', ['test', '--prefix', 'demo/toy-repo'], {
			cwd: REPO_ROOT,
			timeout: 120_000,
		});
		return { passed: true, output: `${stdout}\n${stderr}`.trim() };
	} catch (error) {
		const err = error as { stdout?: string; stderr?: string; message?: string };
		return { passed: false, output: `${err.stdout ?? ''}\n${err.stderr ?? err.message ?? ''}`.trim() };
	}
}

/**
 * The code edit.
 *
 * With RocketRide credentials this is R2's job (reason on the cheap model, patch
 * on the strong one). Without them there is no LLM to call, so we fall back to
 * the fix the inherited blocker already describes: the refill comparison excludes
 * the exact boundary. The fallback is deterministic and clearly labelled — it is
 * not RocketRide, and the demo says so.
 */
async function applyFix(blockerDescription: string): Promise<{ applied: boolean; how: string; diff: string }> {
	const target = resolve(REPO_ROOT, DEMO_TARGET_FILE);
	const before = await readFile(target, 'utf8');

	if (!before.includes('elapsedMs > 1000')) {
		return { applied: false, how: 'already-fixed', diff: '' };
	}

	const after = before.replace('elapsedMs > 1000', 'elapsedMs >= 1000');
	await writeFile(target, after, 'utf8');

	return {
		applied: true,
		how: 'deterministic-fallback',
		diff: `-      if (elapsedMs > 1000) {\n+      if (elapsedMs >= 1000) {\n\n(from the inherited blocker: "${blockerDescription}")`,
	};
}

/**
 * Drop the task graph so a rehearsal starts from an empty memory.
 *
 * Without this, the second rehearsal inherits the first rehearsal's resolved
 * blocker and agent-authored steps — F3 returns zero open blockers and the demo
 * has nothing to hand the autopilot. Rehearsing is exactly when that bites.
 */
export async function resetDemoGraph(taskId: string = DEMO_TASK_ID): Promise<string> {
	const graph = graphNameForTask(taskId);

	if ((process.env.FALKOR_MODE ?? 'fixture') !== 'live') {
		const dir = process.env.FALKOR_FIXTURE_DIR ?? resolve(REPO_ROOT, '.falkordb-fixtures');
		await rm(dir, { recursive: true, force: true });
		return `${graph} (fixture store cleared)`;
	}

	const { FalkorDB } = await import('falkordb');
	const url = process.env.FALKORDB_URL ?? 'redis://localhost:6379';
	const db = await FalkorDB.connect({ url });
	try {
		const existing = await db.list();
		if (existing.includes(graph)) {
			await db.selectGraph(graph).delete();
			return `${graph} (dropped)`;
		}
		return `${graph} (did not exist)`;
	} finally {
		await db.close();
	}
}

/** Revert the demo patch so the scenario can be run again from a failing state. */
export async function resetDemoRepo(): Promise<boolean> {
	const target = resolve(REPO_ROOT, DEMO_TARGET_FILE);
	const current = await readFile(target, 'utf8');
	if (!current.includes('elapsedMs >= 1000')) return false;
	await writeFile(target, current.replace('elapsedMs >= 1000', 'elapsedMs > 1000'), 'utf8');
	return true;
}

/**
 * Attempt the real R2 pipeline and report exactly what happened.
 *
 * Returns a `live` stage only if RocketRide actually produced an answer. A
 * missing key, a refused start, or a model-credential error all come back as
 * `degraded` with the server's own message, so the run never overstates itself.
 */
async function tryRocketRideResume(input: {
	taskId: string;
	goal: string;
	eventTail: number;
}): Promise<Stage> {
	const name = 'reason_and_code_edit';

	if (!process.env.ROCKETRIDE_APIKEY) {
		return {
			name,
			status: 'degraded',
			detail:
				'ROCKETRIDE_APIKEY is unset, so the R2 pipeline (Reason on openai-5-mini, CodeEdit on ' +
				'claude-opus-4-6) did not run. Falling back to the fix implied by the inherited blocker.',
		};
	}

	try {
		const { RocketRideClient, Question } = await import('rocketride');
		const client = new RocketRideClient();
		await client.connect();

		try {
			const started = await client.use({
				filepath: resolve(REPO_ROOT, 'pipeline/relay-resume.pipe'),
				useExisting: true,
				pipelineTraceLevel: 'summary',
				ttl: 300,
			});

			const question = new Question();
			question.addQuestion(`Resume task ${input.taskId}. Inherited blocker: ${input.goal}`);
			question.addContext({ task_id: input.taskId, event_tail_size: input.eventTail });

			const answer = await client.chat({ token: started.token, question });
			const text = answer.answers?.[0];

			await client.terminate(started.token).catch(() => undefined);

			return text
				? { name, status: 'live', detail: `R2 ran (token ${started.token})`, data: { answer: text } }
				: { name, status: 'degraded', detail: `R2 started (token ${started.token}) but returned no answer.` };
		} finally {
			await client.disconnect().catch(() => undefined);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			name,
			status: 'degraded',
			detail: `R2 did not complete: ${message.slice(0, 220)}. Falling back to the fix implied by the inherited blocker.`,
		};
	}
}

export async function runAutopilot(options: AutopilotOptions = {}): Promise<AutopilotResult> {
	const taskId = options.taskId ?? DEMO_TASK_ID;
	const sessionId = options.sessionId ?? `autopilot-${Date.now()}`;
	const replayOffset = options.replayOffset ?? 0;
	const startedAt = new Date().toISOString();
	const graph = graphNameForTask(taskId);

	const stages: Stage[] = [];
	let l3Records = 0;

	const laser = await createLaserClient();
	await laser.ensure(L3_STREAM, L3_TOPIC);

	const emit = async (action: string, payload: Record<string, unknown>): Promise<void> => {
		const event: DevSessionEvent = {
			session_id: sessionId,
			task_id: taskId,
			event_type: 'agent_action',
			timestamp: new Date().toISOString(),
			payload: { agent: AGENT_ID, action, ...payload },
		};
		await laser.publish(L3_STREAM, L3_TOPIC, event);
		l3Records += 1;
	};

	const stage = async (s: Stage): Promise<void> => {
		stages.push(s);
		options.onProgress?.(s);
		await emit(s.name, { status: s.status, detail: s.detail });
	};

	try {
		// 1. ReplayEventTail — rebuild from the log, not from anyone's memory.
		const tail = await laser.replayFromOffset(L1_STREAM, L1_TOPIC, replayOffset);
		await stage({
			name: 'replay_event_tail',
			status: laser.mode === 'live' ? 'live' : 'degraded',
			detail: `replayed ${tail.length} L1 event(s) from offset ${replayOffset} (LaserData ${laser.mode} mode)`,
			data: { events: tail.length, offset: replayOffset },
		});

		// 2. FetchGraphContext — F2 + F3 against the live graph.
		const context = await reconstructContext(taskId);
		const openBlockers = await lookupOpenBlockers(taskId);
		const falkorProbe = await createFalkorClient();
		const falkorMode = falkorProbe.mode;
		await falkorProbe.close();

		await stage({
			name: 'fetch_graph_context',
			status: falkorMode === 'live' ? 'live' : 'degraded',
			detail: `F2 returned ${context.steps.length} step(s); F3 returned ${openBlockers.length} open blocker(s) from ${graph} (FalkorDB ${falkorMode} mode)`,
			data: { steps: context.steps.length, open_blockers: openBlockers.map((b) => b.blocker_id) },
		});

		const inherited = openBlockers[0];
		const blockerDescription = inherited?.blocker_description ?? 'boundary refill failure at exactly 1000 ms';

		// 3. Reason + CodeEdit — really attempt RocketRide R2 when a key is present.
		//
		// It is not enough to check that a key exists and then quietly apply the
		// local fix: that would imply the pipeline ran. Attempt it, report what
		// actually happened, and only then fall back.
		const r2 = await tryRocketRideResume({ taskId, goal: blockerDescription, eventTail: tail.length });
		await stage(r2);

		// 4. TestRunner with a retry loop — the tests are always run for real.
		let attempts = 0;
		let testsPassed = false;
		let patch = { applied: false, how: 'not-attempted', diff: '' };
		let lastOutput = '';

		while (attempts < 3 && !testsPassed) {
			attempts += 1;
			const result = await runTests();
			lastOutput = result.output;

			if (result.passed) {
				testsPassed = true;
				await stage({
					name: 'test_runner',
					status: 'live',
					detail: `attempt ${attempts}: npm test in demo/toy-repo passed`,
					data: { attempt: attempts },
				});
				break;
			}

			await stage({
				name: 'test_runner',
				status: 'live',
				detail: `attempt ${attempts}: npm test in demo/toy-repo failed — ${firstAssertion(result.output)}`,
				data: { attempt: attempts },
			});

			if (!patch.applied) {
				patch = await applyFix(blockerDescription);
				await stage({
					name: 'code_edit',
					status: patch.how === 'deterministic-fallback' ? 'degraded' : 'skipped',
					detail: patch.applied
						? `patched ${DEMO_TARGET_FILE} (${patch.how})`
						: `no patch applied (${patch.how})`,
					data: { diff: patch.diff },
				});
			}
		}

		// 5. F6 — agent write-back into the SAME graph Track 1 built.
		const falkor = await createFalkorClient();
		const now = new Date().toISOString();
		try {
			await falkor.ensureSchema(graph);
			const stepId = `step_agent_${Date.now()}`;

			await falkor.mergeStep(graph, {
				id: stepId,
				task_id: taskId,
				order: 90,
				description: `autopilot: ${testsPassed ? 'fixed the refill boundary and got a green suite' : 'attempted the refill boundary fix'}`,
				status: testsPassed ? 'completed' : 'started',
				started_at: startedAt,
				completed_at: testsPassed ? now : null,
			});

			await falkor.mergeFile(graph, { step_id: stepId, path: DEMO_TARGET_FILE });

			await falkor.mergeDecision(graph, {
				id: `${stepId}:decision`,
				task_id: taskId,
				step_id: stepId,
				text: 'widen the refill comparison to include the exact one-second boundary',
				reasoning:
					'the inherited blocker showed only the exact-boundary case failing, which is a strict-comparison bug rather than a bucket-maths bug',
				embedding: null,
				created_at: now,
			});

			if (testsPassed && inherited) {
				await falkor.mergeBlockerResolved(graph, {
					id: inherited.blocker_id,
					resolved_at: now,
				});
			}

			const counts = await falkor.countNodesByLabel(graph);
			await stage({
				name: 'falkordb_write_back',
				status: falkor.mode === 'live' ? 'live' : 'degraded',
				detail: `F6: wrote an agent-authored Step, Decision and File into ${graph}${testsPassed ? ' and closed the inherited blocker' : ''}`,
				data: { step_id: stepId, node_counts: counts },
			});
		} finally {
			await falkor.close();
		}

		// 6. OpenPR / NotifySlack — only claimed when the credentials exist.
		await stage({
			name: 'open_pr',
			status: process.env.GITHUB_TOKEN ? 'skipped' : 'skipped',
			detail: process.env.GITHUB_TOKEN
				? 'PR creation is owned by R2 tool_github; not invoked in the local demo run'
				: 'no GITHUB_TOKEN, so no pull request was opened',
		});

		const endedAt = new Date().toISOString();
		await emit('run_complete', { tests_passed: testsPassed, attempts, l3_records: l3Records + 1 });

		if (!testsPassed) {
			stages.push({
				name: 'summary',
				status: 'failed',
				detail: `tests still failing after ${attempts} attempt(s): ${firstAssertion(lastOutput)}`,
			});
		}

		return {
			taskId,
			sessionId,
			startedAt,
			endedAt,
			stages,
			testsPassed,
			attempts,
			patchApplied: patch.applied,
			graph,
			l3Records,
		};
	} finally {
		await laser.close();
	}
}

function firstAssertion(output: string): string {
	const line = output
		.split('\n')
		.map((l) => l.trim())
		.find((l) => l.includes('actual:') || l.includes('not ok') || l.includes('ERR_ASSERTION'));
	return line ?? 'see test output';
}
