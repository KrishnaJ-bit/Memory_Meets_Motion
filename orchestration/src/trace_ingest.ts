// LaserData L3 (`relay.agent.actions`) publisher, fed from RocketRide traces.
//
// EXECUTION.md requires "one record per pipeline node execution" on L3. Having
// each agent POST its own actions is best-effort — an agent that dies mid-wave
// emits nothing. RocketRide's DAP monitor stream is the reliable source: every
// component entry/exit arrives as an `apaevt_flow` event, so this module turns
// the trace stream into L3 records, and writes the same records to
// evidence/agent-actions-<token>.jsonl for the Execution Log.
//
// Requires the task to have been started with pipelineTraceLevel >= 'summary'
// (see rocketride.ts) — otherwise apaevt_flow never fires.

import { appendFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { DAPMessage } from 'rocketride';
import { EVIDENCE_DIR } from './config.js';
import { LaserDataClient, STREAM_L3, laserdata, type RelayEvent } from './laserdata.js';

export interface FlowBody {
	id: number;
	op: 'begin' | 'enter' | 'leave' | 'end';
	pipes?: string[];
	component?: string;
	trace?: { lane?: string; data?: unknown; result?: string; error?: string };
	result?: unknown;
	project_id: string;
	source: string;
}

export interface IngestStats {
	flowEvents: number;
	published: number;
	publishErrors: number;
	taskEvents: number;
	errors: string[];
}

export class TraceIngester {
	readonly stats: IngestStats = { flowEvents: 0, published: 0, publishErrors: 0, taskEvents: 0, errors: [] };
	private evidencePath?: string;

	constructor(
		private readonly context: { taskId: string; sessionId: string; runToken: string },
		private readonly client: LaserDataClient = laserdata
	) {}

	private async evidenceFile(): Promise<string> {
		if (!this.evidencePath) {
			await mkdir(EVIDENCE_DIR, { recursive: true });
			this.evidencePath = resolve(EVIDENCE_DIR, `agent-actions-${this.context.runToken}.jsonl`);
		}
		return this.evidencePath;
	}

	/** Wire this into RocketRideClient's onEvent callback. */
	handleEvent = async (message: DAPMessage): Promise<void> => {
		if (message.type !== 'event') return;

		switch (message.event) {
			case 'apaevt_flow':
				await this.onFlow(message.body as unknown as FlowBody);
				break;
			case 'apaevt_task':
				this.stats.taskEvents += 1;
				break;
			case 'apaevt_sse':
				await this.onNodeMessage(message.body as unknown as { pipe_id: number; type: string; data: unknown });
				break;
			default:
				break;
		}
	};

	private async onFlow(body: FlowBody): Promise<void> {
		this.stats.flowEvents += 1;

		// 'enter'/'leave' bracket one component; 'begin'/'end' bracket the pipe.
		const action: RelayEvent = {
			session_id: this.context.sessionId,
			task_id: this.context.taskId,
			event_type: 'agent_action',
			timestamp: new Date().toISOString(),
			payload: {
				source: 'rocketride.flow',
				run_token: this.context.runToken,
				project_id: body.project_id,
				pipeline_source: body.source,
				pipe_id: body.id,
				op: body.op,
				component: body.component ?? body.pipes?.at(-1) ?? null,
				lane: body.trace?.lane ?? null,
				result: body.trace?.result ?? null,
				error: body.trace?.error ?? null,
			},
		};

		await this.emit(action);
	}

	private async onNodeMessage(body: { pipe_id: number; type: string; data: unknown }): Promise<void> {
		await this.emit({
			session_id: this.context.sessionId,
			task_id: this.context.taskId,
			event_type: 'agent_action',
			timestamp: new Date().toISOString(),
			payload: {
				source: 'rocketride.sse',
				run_token: this.context.runToken,
				pipe_id: body.pipe_id,
				type: body.type,
				data: body.data,
			},
		});
	}

	private async emit(action: RelayEvent): Promise<void> {
		// Local evidence first: it must survive a LaserData outage.
		await appendFile(await this.evidenceFile(), `${JSON.stringify(action)}\n`, 'utf8');

		if (!this.client.configured) return;
		try {
			await this.client.publish(STREAM_L3, action);
			this.stats.published += 1;
		} catch (error) {
			this.stats.publishErrors += 1;
			this.stats.errors.push(error instanceof Error ? error.message : String(error));
		}
	}

	summary(): string {
		return [
			`flow events: ${this.stats.flowEvents}`,
			`L3 published: ${this.stats.published}`,
			`publish errors: ${this.stats.publishErrors}`,
			`evidence: ${this.evidencePath ?? '(none written)'}`,
		].join(' | ');
	}
}
