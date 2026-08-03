// RocketRide runner for R1 (relay-capture) and R2 (relay-resume).
//
// Verified against rocketride@1.3.0 typings (dist/types/client.d.ts):
//   use({ filepath, useExisting, pipelineTraceLevel, ttl }) -> { token, ... }
//   chat({ token, question }), send(token, data, objinfo?, mimetype?)
//   addMonitor({ token } | { projectId, source }, types[]), getTaskStatus(token)
//
// Every run is started with pipelineTraceLevel: 'summary'. Per the observability
// doc, apaevt_flow events do NOT fire unless the *executor* asks for them — so
// the trace evidence the Execution Log needs depends on this flag being set here.

import { RocketRideClient, Question } from 'rocketride';
import type { DAPMessage, PIPELINE_RESULT } from 'rocketride';
import { CAPTURE_PIPE, RESUME_PIPE, config } from './config.js';

export type TraceLevel = 'none' | 'metadata' | 'summary' | 'full';

export interface RunHandle {
	client: RocketRideClient;
	token: string;
	pipeline: 'relay-capture' | 'relay-resume';
	filepath: string;
	startedAt: string;
}

export interface RunnerOptions {
	traceLevel?: TraceLevel;
	useExisting?: boolean;
	/** Forwarded to the client so the trace ingester can consume flow events. */
	onEvent?: (event: DAPMessage) => void | Promise<void>;
	/** Idle TTL in seconds; 0 disables the timeout. */
	ttl?: number;
}

export function createClient(onEvent?: RunnerOptions['onEvent']): RocketRideClient {
	return new RocketRideClient({
		uri: config.rocketride.uri,
		auth: config.rocketride.apikey,
		onEvent: onEvent
			? async (event: DAPMessage) => {
					await onEvent(event);
				}
			: undefined,
	});
}

async function start(
	pipeline: RunHandle['pipeline'],
	filepath: string,
	options: RunnerOptions
): Promise<RunHandle> {
	const client = createClient(options.onEvent);
	await client.connect();

	const result = await client.use({
		filepath,
		useExisting: options.useExisting ?? true,
		pipelineTraceLevel: options.traceLevel ?? 'summary',
		ttl: options.ttl,
	});

	// Subscribe to the monitor stream so lifecycle + component traces reach onEvent.
	await client.addMonitor({ token: result.token }, ['task', 'summary', 'flow', 'output', 'sse']);

	return {
		client,
		token: result.token,
		pipeline,
		filepath,
		startedAt: new Date().toISOString(),
	};
}

/** R1 — start the capture/summarization pipeline (webhook source). */
export function startCapturePipeline(options: RunnerOptions = {}): Promise<RunHandle> {
	return start('relay-capture', CAPTURE_PIPE, options);
}

/** R2 — start the resume/completion pipeline (chat source). */
export function startResumePipeline(options: RunnerOptions = {}): Promise<RunHandle> {
	return start('relay-resume', RESUME_PIPE, options);
}

/**
 * Feed one batch of L1 events into R1. The capture pipeline's source is a
 * `webhook`, so this is send() — chat() would be the wrong method here.
 */
export async function sendEventBatch(
	handle: RunHandle,
	events: unknown[]
): Promise<PIPELINE_RESULT | undefined> {
	return handle.client.send(handle.token, JSON.stringify(events, null, 2), { name: 'l1-batch.json' }, 'text/plain');
}

/**
 * Ask R2 to resume a task. The resume pipeline's source is `chat`, so this is
 * chat() with a Question carrying the task id, goal and replay offset.
 */
export async function requestResume(
	handle: RunHandle,
	params: {
		taskId: string;
		sessionId: string;
		goal: string;
		replayOffset: number | string;
		/** L1 tail replayed by the caller — the pipeline cannot reach Iggy itself. */
		eventTail: unknown[];
		targetRepo?: string;
	}
): Promise<PIPELINE_RESULT> {
	const question = new Question();
	question.addQuestion(
		`Resume interrupted task ${params.taskId}. Goal: ${params.goal}`
	);
	question.addContext({
		task_id: params.taskId,
		session_id: params.sessionId,
		replay_offset: params.replayOffset,
		event_tail: params.eventTail,
		target_repo: params.targetRepo ?? config.github.targetRepo,
		graph_hint: 'Query the per-task graph; nodes authored by humans have no author property.',
	});
	question.addInstruction(
		'Evidence',
		'Report the Cypher you ran, the replay offset you read from, the PR URL, and the number of test attempts.'
	);
	question.addGoal('Open a pull request that finishes the interrupted work and explains what it inherited.');

	return handle.client.chat({ token: handle.token, question });
}

export async function stop(handle: RunHandle): Promise<void> {
	try {
		await handle.client.terminate(handle.token);
	} finally {
		await handle.client.disconnect();
	}
}
