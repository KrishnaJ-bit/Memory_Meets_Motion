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
//
// Fixture mode: this class used to have none — every G1/G2 run hard-failed
// without a live LaserData connection string, unlike Track 1's capture/
// adapter, which always had a file-backed fallback. Fixed 2026-08-03 (no
// LaserData Cloud credentials were available for this run) by adding the same
// kind of fallback here, using the *same* file-naming convention Track 1's
// `capture/src/laser/fixtureClient.ts` and the demo scripts already use
// (`.laserdata-fixtures/<stream>__<topic>.jsonl`), so a G1/G2 run in this
// process sees the exact events the terminal demo already published — not a
// second, disconnected fixture store.

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Laser } from '@laserdata/laser-sdk';
import type { Topic } from '@laserdata/laser-sdk';
import { REPO_ROOT, config } from './config.js';

export const STREAM_L1 = 'dev.session.events';
export const STREAM_L2 = 'relay.graph.mutations';
export const STREAM_L3 = 'relay.agent.actions';

/** Matches capture/src/laser/client.ts and demo/relay/autopilot.ts's topic names for the same streams. */
const FIXTURE_TOPIC_BY_STREAM: Record<string, string> = {
	[STREAM_L1]: 'sessions',
	[STREAM_L2]: 'mutations',
	[STREAM_L3]: 'actions',
};

function fixtureDir(): string {
	return process.env.LASER_FIXTURE_DIR ?? path.join(REPO_ROOT, '.laserdata-fixtures');
}

function fixtureFile(streamName: string): string {
	const topic = FIXTURE_TOPIC_BY_STREAM[streamName] ?? 'default';
	return path.join(fixtureDir(), `${streamName}__${topic}.jsonl`);
}

interface FixtureRecord {
	offset: number;
	payload: unknown;
}

async function fixtureReadAll(streamName: string): Promise<FixtureRecord[]> {
	const file = fixtureFile(streamName);
	if (!existsSync(file)) return [];
	const raw = await readFile(file, 'utf8');
	return raw
		.split('\n')
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line) as FixtureRecord);
}

async function fixtureAppend(streamName: string, payload: unknown): Promise<void> {
	const dir = fixtureDir();
	await mkdir(dir, { recursive: true });
	const offset = (await fixtureReadAll(streamName)).length;
	await appendFile(fixtureFile(streamName), `${JSON.stringify({ offset, payload })}\n`);
}

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

	/** `live` needs LASER_CONNECTION_STRING and an explicit opt-in; fixture is the safe default. */
	get mode(): 'live' | 'fixture' {
		return (process.env.LASER_MODE ?? 'fixture') === 'live' ? 'live' : 'fixture';
	}

	get configured(): boolean {
		return this.mode === 'fixture' || Boolean(config.laserdata.connectionString);
	}

	/** Lazily connect; safe to call repeatedly. */
	private async client(): Promise<Laser> {
		if (this.laser) return this.laser;
		if (!config.laserdata.connectionString) {
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
		if (this.mode === 'fixture') {
			await fixtureAppend(topicName, event);
			return { topic: topicName, status: 'sent' };
		}
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
		const startOffset = typeof fromOffset === 'object' ? Number(fromOffset.get(0) ?? 0n) : Number(fromOffset);

		if (this.mode === 'fixture') {
			const all = await fixtureReadAll(topicName);
			const slice = all.filter((r) => r.offset >= startOffset).slice(0, limit);
			const events = slice.map((r) => r.payload as RelayEvent);
			const lastOffset = slice.length > 0 ? BigInt(slice[slice.length - 1]!.offset + 1) : BigInt(startOffset);
			return { events, offsets: new Map([[0, lastOffset]]) };
		}

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
