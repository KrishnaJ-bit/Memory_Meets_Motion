// Runs a Guild agent inside an audited session.
//
// Every agent run opens a session, streams its log lines into that session as
// audit steps, and closes it with the result — which is what makes the "3+
// audited sessions" requirement (EXECUTION.md §1) provable rather than asserted.

import { randomUUID } from 'node:crypto';
import { resolveTransport, type GuildTransport } from './client.js';
import type { GuildAgentDefinition, GuildRunResult, GuildTriggerKind } from './types.js';

export interface InvokeOptions {
	taskId: string;
	sessionId?: string;
	trigger?: { kind: GuildTriggerKind; event?: string; payload?: Record<string, unknown> };
	transport?: GuildTransport;
}

export interface InvokeOutcome extends GuildRunResult {
	agent: string;
	guildSessionId: string;
	transport: 'gateway' | 'local';
	startedAt: string;
	endedAt: string;
}

export async function invokeAgent(agent: GuildAgentDefinition, options: InvokeOptions): Promise<InvokeOutcome> {
	const transport = options.transport ?? resolveTransport();
	const sessionId = options.sessionId ?? `sess-${randomUUID()}`;
	const startedAt = new Date().toISOString();

	const session = await transport.startSession(agent.name, {
		task_id: options.taskId,
		session_id: sessionId,
		trigger: options.trigger ?? { kind: 'manual' },
		scope: agent.scope,
	});

	const log = (message: string, data?: Record<string, unknown>) => {
		void transport.appendSession(session, { message, data: data ?? {}, at: new Date().toISOString() });
		console.log(`[${agent.name}] ${message}${data ? ` ${JSON.stringify(data)}` : ''}`);
	};

	let result: GuildRunResult;
	try {
		result = await agent.run({ taskId: options.taskId, sessionId, trigger: options.trigger, log });
	} catch (error) {
		result = {
			status: 'failed',
			summary: error instanceof Error ? error.message : String(error),
			evidence: { error: String(error) },
		};
	}

	await transport.endSession(session, result);

	return {
		...result,
		agent: agent.name,
		guildSessionId: session.sessionId,
		transport: transport.kind,
		startedAt,
		endedAt: new Date().toISOString(),
	};
}
