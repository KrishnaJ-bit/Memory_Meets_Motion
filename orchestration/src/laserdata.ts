// LaserData client for Track 2's stream: L3 `relay.agent.actions`.
//
// There is no published LaserData npm client (verified against the npm registry
// on 2026-08-03: `laserdata`, `@laserdata/client` and `laserdata-client` are all
// 404). Until the real client is confirmed, this speaks plain HTTP against
// LASERDATA_STREAM_URL using the event envelope fixed in AGENTS.md, and keeps
// the transport behind one interface so swapping in the SDK is a single edit.

import { config } from './config.js';

export const STREAM_L1 = 'dev.session.events';
export const STREAM_L2 = 'relay.graph.mutations';
export const STREAM_L3 = 'relay.agent.actions';

export type EventType = 'file_save' | 'terminal_cmd' | 'diff' | 'note' | 'graph_write' | 'agent_action';

/** The envelope every Relay event carries, per AGENTS.md → Conventions. */
export interface RelayEvent<P = Record<string, unknown>> {
	session_id: string;
	task_id: string;
	event_type: EventType;
	timestamp: string;
	payload: P;
}

export interface PublishResult {
	topic: string;
	offset?: number | string;
	status: number;
	body: unknown;
}

export class LaserDataError extends Error {
	constructor(
		message: string,
		readonly status?: number,
		readonly body?: unknown
	) {
		super(message);
		this.name = 'LaserDataError';
	}
}

export class LaserDataClient {
	constructor(
		private readonly streamUrl = config.laserdata.streamUrl,
		private readonly apiToken = config.laserdata.apiToken
	) {}

	get configured(): boolean {
		return Boolean(this.streamUrl);
	}

	private headers(): Record<string, string> {
		const h: Record<string, string> = { 'content-type': 'application/json' };
		if (this.apiToken) h.authorization = `Bearer ${this.apiToken}`;
		return h;
	}

	private assertConfigured(): void {
		if (!this.streamUrl) {
			throw new LaserDataError('LASERDATA_STREAM_URL is not set — cannot publish or replay.');
		}
	}

	/** Publish one event to a topic. Returns the offset the broker assigned, when it reports one. */
	async publish(topic: string, event: RelayEvent): Promise<PublishResult> {
		this.assertConfigured();
		const url = new URL(this.streamUrl);
		url.searchParams.set('topic', topic);

		const res = await fetch(url, {
			method: 'POST',
			headers: this.headers(),
			body: JSON.stringify(event),
		});
		const body = await safeJson(res);
		if (!res.ok) {
			throw new LaserDataError(`publish to ${topic} failed (${res.status})`, res.status, body);
		}
		const offset = (body as { offset?: number | string } | undefined)?.offset;
		return { topic, offset, status: res.status, body };
	}

	/** Publish an L3 agent-action record. */
	async publishAgentAction(
		taskId: string,
		sessionId: string,
		payload: Record<string, unknown>
	): Promise<PublishResult> {
		return this.publish(STREAM_L3, {
			session_id: sessionId,
			task_id: taskId,
			event_type: 'agent_action',
			timestamp: new Date().toISOString(),
			payload,
		});
	}

	/**
	 * Replay a topic from a byte/record offset — the L1 replay contract Track 1 owns
	 * and R2 consumes. Rebuilds resume context from the log rather than from memory.
	 */
	async replay(topic: string, fromOffset: number | string, limit = 200): Promise<RelayEvent[]> {
		this.assertConfigured();
		const url = new URL(this.streamUrl);
		url.searchParams.set('topic', topic);
		url.searchParams.set('offset', String(fromOffset));
		url.searchParams.set('limit', String(limit));

		const res = await fetch(url, { method: 'GET', headers: this.headers() });
		const body = await safeJson(res);
		if (!res.ok) {
			throw new LaserDataError(`replay of ${topic}@${fromOffset} failed (${res.status})`, res.status, body);
		}
		if (Array.isArray(body)) return body as RelayEvent[];
		const events = (body as { events?: RelayEvent[] } | undefined)?.events;
		return events ?? [];
	}
}

async function safeJson(res: Response): Promise<unknown> {
	const text = await res.text();
	if (!text) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

export const laserdata = new LaserDataClient();
