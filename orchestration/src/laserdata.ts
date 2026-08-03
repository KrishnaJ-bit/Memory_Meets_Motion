// LaserData client for Track 2's stream: L3 `relay.agent.actions`.
//
// Uses the real SDK: `@laserdata/laser-sdk` (verified 2026-08-03, v0.0.1).
// An earlier draft of this file spoke HTTP against a `LASERDATA_STREAM_URL`
// because the package had not been found under the names AGENTS.md implied.
// That was wrong twice over: the package exists under the `@laserdata` scope,
// and its transport is Apache Iggy over TCP/QUIC, not HTTP — so no amount of
// POSTing to a URL would have worked.
//
// Config comes from LASER_CONNECTION_STRING (+ optional LASER_STREAM), which is
// what `Laser.connectEnv()` reads.

import { Laser } from '@laserdata/laser-sdk';
import type { Topic } from '@laserdata/laser-sdk';
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
	status: 'sent';
}

export class LaserDataError extends Error {
	constructor(
		message: string,
		readonly cause?: unknown
	) {
		super(message);
		this.name = 'LaserDataError';
	}
}

export class LaserDataClient {
	private laser?: Laser;
	private readonly ensured = new Set<string>();

	get configured(): boolean {
		return Boolean(config.laserdata.connectionString);
	}

	/** Lazily connect; safe to call repeatedly. */
	private async client(): Promise<Laser> {
		if (this.laser) return this.laser;
		if (!this.configured) {
			throw new LaserDataError('LASER_CONNECTION_STRING is not set — cannot publish or replay.');
		}
		try {
			this.laser = config.laserdata.stream
				? await Laser.connectWithStream(config.laserdata.connectionString, config.laserdata.stream)
				: await Laser.connect(config.laserdata.connectionString);
		} catch (error) {
			throw new LaserDataError('Failed to connect to LaserData', error);
		}
		return this.laser;
	}

	private async topic(name: string): Promise<Topic> {
		const laser = await this.client();
		const topic = laser.topic(name);
		// ensure() is idempotent and creates the stream too, so a fresh broker works.
		if (!this.ensured.has(name)) {
			await topic.ensure();
			this.ensured.add(name);
		}
		return topic;
	}

	async close(): Promise<void> {
		this.laser = undefined;
		this.ensured.clear();
	}

	/** Publish one event to a topic. */
	async publish(topicName: string, event: RelayEvent): Promise<PublishResult> {
		const topic = await this.topic(topicName);
		try {
			await topic.send(new TextEncoder().encode(JSON.stringify(event)));
		} catch (error) {
			throw new LaserDataError(`publish to ${topicName} failed`, error);
		}
		return { topic: topicName, status: 'sent' };
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

	/** Publish structured decisions to L2 — what R1's agent produces (G1 owns the write). */
	async publishDecisions(taskId: string, sessionId: string, decisions: unknown[]): Promise<number> {
		let sent = 0;
		for (const decision of decisions) {
			await this.publish(STREAM_L2, {
				session_id: sessionId,
				task_id: taskId,
				event_type: 'graph_write',
				timestamp: new Date().toISOString(),
				payload: { decision },
			});
			sent += 1;
		}
		return sent;
	}

	/**
	 * Replay a topic from an offset — the L1 replay contract Track 1 owns and R2
	 * consumes, rebuilding resume context from the log rather than from memory.
	 *
	 * Offsets are per partition in Iggy. `fromOffset` seeds partition 0, which is
	 * what a single-partition demo topic uses; pass a map for a wider topic.
	 */
	async replay(
		topicName: string,
		fromOffset: number | bigint | ReadonlyMap<number, bigint>,
		limit = 200
	): Promise<{ events: RelayEvent[]; offsets: ReadonlyMap<number, bigint> }> {
		const topic = await this.topic(topicName);
		const offsets =
			typeof fromOffset === 'object' ? fromOffset : new Map<number, bigint>([[0, BigInt(fromOffset)]]);

		try {
			const cursor = (await topic.replay({ batchSize: limit })).fromOffsets(offsets);
			const messages = await cursor.poll();
			const decoder = new TextDecoder();
			const events: RelayEvent[] = [];

			for (const message of messages) {
				try {
					events.push(JSON.parse(decoder.decode(message.payload)) as RelayEvent);
				} catch {
					// A non-JSON record on the topic is someone else's business, not ours.
				}
			}
			return { events, offsets: cursor.offsets };
		} catch (error) {
			throw new LaserDataError(`replay of ${topicName} failed`, error);
		}
	}
}

export const laserdata = new LaserDataClient();
