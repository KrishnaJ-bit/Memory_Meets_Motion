// Guild.ai transport seam.
//
// AGENTS.md says to confirm the SDK before writing calls against assumed syntax.
// Checked on 2026-08-03: `@guild-ai/sdk` is a 404 on npm, so there is nothing to
// import. Rather than guess at method names, everything the orchestration layer
// needs from Guild is expressed as this interface:
//
//   - registerAgent   — publish a definition (name, triggers, scope)
//   - registerTrigger — attach a trigger and get back a trigger id
//   - startSession    — open an audited session, return its id
//   - appendSession   — write a step into the session's audit trail
//   - endSession      — close it with a status
//
// `GatewayGuildTransport` implements that over HTTP against GUILD_GATEWAY_URL.
// The exact route names are the one unverified piece here — they are collected
// in ROUTES below so that confirming them against Guild's live docs is a
// single-object edit rather than a rewrite. `LocalGuildTransport` runs the same
// agents with a local audit log when no Guild credentials are present, so the
// pipeline work is testable before the Guild account exists.

import { appendFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { EVIDENCE_DIR, config } from '../config.js';
import type { GuildAgentDefinition, GuildRunResult, GuildTrigger } from './types.js';

export interface GuildSessionHandle {
	sessionId: string;
	agent: string;
	transport: 'gateway' | 'local';
}

export interface GuildTransport {
	readonly kind: 'gateway' | 'local';
	registerAgent(agent: GuildAgentDefinition): Promise<{ agentId: string }>;
	registerTrigger(agentName: string, trigger: GuildTrigger): Promise<{ triggerId: string }>;
	startSession(agentName: string, input: Record<string, unknown>): Promise<GuildSessionHandle>;
	appendSession(session: GuildSessionHandle, step: Record<string, unknown>): Promise<void>;
	endSession(session: GuildSessionHandle, result: GuildRunResult): Promise<void>;
}

/** UNVERIFIED: confirm against Guild.ai's live API docs before the demo run. */
const ROUTES = {
	registerAgent: (workspace: string) => `/v1/workspaces/${workspace}/agents`,
	registerTrigger: (workspace: string, agent: string) => `/v1/workspaces/${workspace}/agents/${agent}/triggers`,
	startSession: (workspace: string, agent: string) => `/v1/workspaces/${workspace}/agents/${agent}/sessions`,
	appendSession: (workspace: string, session: string) => `/v1/workspaces/${workspace}/sessions/${session}/steps`,
	endSession: (workspace: string, session: string) => `/v1/workspaces/${workspace}/sessions/${session}/complete`,
} as const;

export class GatewayGuildTransport implements GuildTransport {
	readonly kind = 'gateway' as const;

	constructor(
		private readonly baseUrl = config.guild.gatewayUrl,
		private readonly apiKey = config.guild.apiKey,
		private readonly workspace = config.guild.workspaceId
	) {}

	private async call<T>(path: string, body: unknown): Promise<T> {
		const res = await fetch(`${this.baseUrl}${path}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
			body: JSON.stringify(body),
		});
		const text = await res.text();
		if (!res.ok) {
			throw new Error(`Guild gateway ${path} failed (${res.status}): ${text}`);
		}
		return (text ? JSON.parse(text) : {}) as T;
	}

	async registerAgent(agent: GuildAgentDefinition) {
		return this.call<{ agentId: string }>(ROUTES.registerAgent(this.workspace), {
			name: agent.name,
			description: agent.description,
			scope: agent.scope,
		});
	}

	async registerTrigger(agentName: string, trigger: GuildTrigger) {
		return this.call<{ triggerId: string }>(ROUTES.registerTrigger(this.workspace, agentName), trigger);
	}

	async startSession(agentName: string, input: Record<string, unknown>): Promise<GuildSessionHandle> {
		const res = await this.call<{ sessionId: string }>(ROUTES.startSession(this.workspace, agentName), { input });
		return { sessionId: res.sessionId, agent: agentName, transport: 'gateway' };
	}

	async appendSession(session: GuildSessionHandle, step: Record<string, unknown>) {
		await this.call(ROUTES.appendSession(this.workspace, session.sessionId), step);
	}

	async endSession(session: GuildSessionHandle, result: GuildRunResult) {
		await this.call(ROUTES.endSession(this.workspace, session.sessionId), result);
	}
}

/** Fallback transport: same audit trail, written to evidence/guild-sessions.jsonl. */
export class LocalGuildTransport implements GuildTransport {
	readonly kind = 'local' as const;

	private async write(record: Record<string, unknown>): Promise<void> {
		await mkdir(EVIDENCE_DIR, { recursive: true });
		await appendFile(
			resolve(EVIDENCE_DIR, 'guild-sessions.jsonl'),
			`${JSON.stringify({ ...record, at: new Date().toISOString() })}\n`,
			'utf8'
		);
	}

	async registerAgent(agent: GuildAgentDefinition) {
		const agentId = `local-agent-${agent.name}`;
		await this.write({ kind: 'register_agent', agentId, name: agent.name, scope: agent.scope });
		return { agentId };
	}

	async registerTrigger(agentName: string, trigger: GuildTrigger) {
		const triggerId = `local-trigger-${agentName}-${trigger.kind}`;
		await this.write({ kind: 'register_trigger', triggerId, agent: agentName, trigger });
		return { triggerId };
	}

	async startSession(agentName: string, input: Record<string, unknown>): Promise<GuildSessionHandle> {
		const sessionId = `local-session-${randomUUID()}`;
		await this.write({ kind: 'session_start', sessionId, agent: agentName, input });
		return { sessionId, agent: agentName, transport: 'local' };
	}

	async appendSession(session: GuildSessionHandle, step: Record<string, unknown>) {
		await this.write({ kind: 'session_step', sessionId: session.sessionId, agent: session.agent, step });
	}

	async endSession(session: GuildSessionHandle, result: GuildRunResult) {
		await this.write({ kind: 'session_end', sessionId: session.sessionId, agent: session.agent, result });
	}
}

/** Gateway when credentials exist, local audit log otherwise. */
export function resolveTransport(): GuildTransport {
	if (config.guild.apiKey && config.guild.workspaceId) {
		return new GatewayGuildTransport();
	}
	return new LocalGuildTransport();
}
