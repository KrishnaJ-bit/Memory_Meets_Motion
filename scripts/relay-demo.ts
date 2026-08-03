#!/usr/bin/env -S npx tsx
/**
 * The end-to-end Relay demo.
 *
 *   npm run demo                 full arc: session -> graph -> absence -> autopilot
 *   npm run demo -- --reset      put the toy repo back in its failing state
 *   npm run demo -- --stage 1    run one stage only
 *
 * Stage 1  a developer works the checkout rate-limit task and walks away
 * Stage 2  the capture consumer turns that stream into a memory graph
 * Stage 3  what the graph knows: the decisions, and the blocker left open
 * Stage 4  the developer leaves; autopilot inherits the task and finishes it
 * Stage 5  what changed: agent-authored nodes, blocker closed, tests green
 */

import 'dotenv/config';
import { rm } from 'node:fs/promises';
import { buildScenarioSession, DEMO_TASK_ID } from '../demo/relay/scenario-session.js';
import { runAutopilot, resetDemoRepo, resetDemoGraph, type Stage } from '../demo/relay/autopilot.js';
import { createLaserClient, L1_STREAM, L1_TOPIC } from '../capture/src/laser/client.js';
import { createFalkorClient } from '../memory/src/falkor/client.js';
import { consumeL1ToGraph } from '../memory/src/consumer.js';
import { reconstructContext } from '../memory/src/queries/f2.js';
import { lookupOpenBlockers } from '../memory/src/queries/f3.js';
import { graphNameForTask } from '../src/shared/graph-contract.js';
import { assertDevSessionEvent } from '../src/shared/envelope.js';

const BOLD = '[1m';
const DIM = '[2m';
const GREEN = '[32m';
const YELLOW = '[33m';
const RED = '[31m';
const RESET = '[0m';

function heading(n: number, title: string): void {
	console.log(`\n${BOLD}── Stage ${n} · ${title}${RESET}`);
}

function badge(status: Stage['status']): string {
	if (status === 'live') return `${GREEN}live${RESET}`;
	if (status === 'degraded') return `${YELLOW}degraded${RESET}`;
	if (status === 'failed') return `${RED}failed${RESET}`;
	return `${DIM}skipped${RESET}`;
}

function arg(name: string): string | undefined {
	const i = process.argv.indexOf(`--${name}`);
	return i === -1 ? undefined : process.argv[i + 1];
}

/**
 * Clear the fixture-mode stream store so a rehearsal does not consume the
 * previous rehearsal's events too. Only touches the local fixture directory —
 * in `LASER_MODE=live` the real log is append-only and is left alone.
 */
async function resetFixtureStreams(): Promise<void> {
	if ((process.env.LASER_MODE ?? 'fixture') !== 'fixture') return;
	const dir = process.env.LASER_FIXTURE_DIR ?? new URL('../.laserdata-fixtures/', import.meta.url).pathname;
	await rm(dir, { recursive: true, force: true });
}

async function stage1(): Promise<{ sessionId: string; events: number }> {
	heading(1, 'A developer works the task, then walks away');

	await resetFixtureStreams();
	const graphReset = await resetDemoGraph(DEMO_TASK_ID);
	console.log(`  ${DIM}reset: ${graphReset}${RESET}`);

	const events = buildScenarioSession();
	events.forEach(assertDevSessionEvent);

	const laser = await createLaserClient();
	await laser.ensure(L1_STREAM, L1_TOPIC);
	for (const event of events) {
		await laser.publish(L1_STREAM, L1_TOPIC, event);
	}
	const total = await laser.count(L1_STREAM, L1_TOPIC);
	await laser.close();

	console.log(`  published ${events.length} L1 events to ${L1_STREAM} (LaserData ${badge(laser.mode === 'live' ? 'live' : 'degraded')} mode)`);
	console.log(`  ${DIM}stream now holds ${total} event(s); session ends on an unresolved blocker${RESET}`);
	return { sessionId: events[0]!.session_id, events: events.length };
}

async function stage2(): Promise<void> {
	heading(2, 'The capture consumer builds the memory graph');
	const summary = await consumeL1ToGraph(0);
	console.log(`  consumed ${summary.eventsProcessed} L1 event(s) -> ${summary.mutationsApplied} MERGE mutation(s)`);
	console.log(`  ${DIM}every write mirrored to relay.graph.mutations (L2); graphs touched: ${summary.graphsTouched.join(', ')}${RESET}`);
}

async function stage3(): Promise<void> {
	heading(3, 'What the graph remembers');

	const context = await reconstructContext(DEMO_TASK_ID);
	const blockers = await lookupOpenBlockers(DEMO_TASK_ID);

	console.log(`  ${BOLD}F2${RESET} task "${context.task_title}" · ${context.steps.length} steps`);
	for (const step of context.steps) {
		const decisions = step.decisions.filter((d) => d.text);
		console.log(`     ${DIM}${step.step_id}${RESET} ${step.step_description}`);
		for (const d of decisions) {
			console.log(`        ${GREEN}decision${RESET} ${d.text}`);
			console.log(`        ${DIM}why: ${d.reasoning}${RESET}`);
		}
	}

	console.log(`\n  ${BOLD}F3${RESET} open blockers inherited by whoever picks this up:`);
	for (const b of blockers) {
		console.log(`     ${RED}${b.blocker_id}${RESET} ${b.blocker_description}`);
		console.log(`     ${DIM}hit during ${b.step_id}; touches ${b.files.join(', ') || '(no files recorded)'}${RESET}`);
	}
	if (blockers.length === 0) {
		console.log(`     ${DIM}(none — run with --reset first to restore the interrupted state)${RESET}`);
	}
}

async function stage4(): Promise<Awaited<ReturnType<typeof runAutopilot>>> {
	heading(4, 'The developer is gone. Autopilot takes the task');
	console.log(`  ${DIM}presence monitor -> developer_absent -> Guild relay-resume -> this run${RESET}\n`);

	return runAutopilot({
		taskId: DEMO_TASK_ID,
		replayOffset: 0,
		onProgress: (s) => console.log(`  [${badge(s.status)}] ${BOLD}${s.name}${RESET} — ${s.detail}`),
	});
}

async function stage5(): Promise<void> {
	heading(5, 'What the agent left behind');

	const falkor = await createFalkorClient();
	const graph = graphNameForTask(DEMO_TASK_ID);
	try {
		const counts = await falkor.countNodesByLabel(graph);
		const blockers = await falkor.listBlockers(graph);
		const open = blockers.filter((b) => !b.resolved);
		console.log(`  graph ${graph}: ${JSON.stringify(counts)}`);
		console.log(`  blockers: ${blockers.length} total, ${open.length} still open`);
		for (const b of blockers) {
			const mark = b.resolved ? `${GREEN}resolved${RESET}` : `${RED}open${RESET}`;
			console.log(`     [${mark}] ${b.id} — ${b.description.slice(0, 88)}`);
		}
	} finally {
		await falkor.close();
	}
}

async function main(): Promise<void> {
	if (process.argv.includes('--reset')) {
		const reverted = await resetDemoRepo();
		const graph = await resetDemoGraph(DEMO_TASK_ID);
		console.log(reverted ? 'Toy repo reverted to the failing state.' : 'Toy repo was already in the failing state.');
		console.log(`Graph reset: ${graph}`);
		return;
	}

	console.log(`${BOLD}Relay — memory that survives the developer leaving${RESET}`);
	console.log(`${DIM}task ${DEMO_TASK_ID} · graph ${graphNameForTask(DEMO_TASK_ID)}${RESET}`);

	const only = arg('stage');
	const wanted = (n: number): boolean => !only || Number(only) === n;

	if (wanted(1)) await stage1();
	if (wanted(2)) await stage2();
	if (wanted(3)) await stage3();

	if (wanted(4)) {
		const result = await stage4();
		if (wanted(5)) await stage5();

		console.log(`\n${BOLD}── Result${RESET}`);
		console.log(`  tests ${result.testsPassed ? `${GREEN}passing${RESET}` : `${RED}still failing${RESET}`} after ${result.attempts} attempt(s)`);
		console.log(`  patch applied: ${result.patchApplied}`);
		console.log(`  L3 agent-action records emitted: ${result.l3Records}`);

		const degraded = result.stages.filter((s) => s.status === 'degraded');
		if (degraded.length > 0) {
			console.log(`\n  ${YELLOW}Ran degraded (no credentials):${RESET}`);
			for (const s of degraded) console.log(`     - ${s.name}: ${s.detail.split('.')[0]}`);
		}
		if (!result.testsPassed) process.exitCode = 1;
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
