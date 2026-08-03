// Guild.ai agent contract for Relay.
//
// IMPORTANT — verified 2026-08-03: the package AGENTS.md names (`@guild-ai/sdk`)
// does not exist on the public npm registry (404), and no other Guild.ai client
// package was found. So the agents below are defined against this local
// contract, and `GuildTransport` (see client.ts) is the single seam where the
// real SDK — or the gateway's HTTP API — gets plugged in. Nothing in agents.ts
// assumes an SDK method name.

export type GuildTriggerKind = 'manual' | 'idle-timeout' | 'scheduled' | 'on-batch' | 'webhook-event';

export interface GuildTrigger {
	kind: GuildTriggerKind;
	/** Provider event name for webhook-event triggers, e.g. 'github.pr.opened'. */
	event?: string;
	/** Seconds of inactivity before an idle-timeout trigger fires. */
	idleSeconds?: number;
	/** Cron expression for scheduled triggers. */
	cron?: string;
	description: string;
}

/**
 * Credential + filesystem scope requested for an agent. G2 in particular must
 * not be able to touch anything outside the target repo (EXECUTION.md §1).
 */
export interface GuildScope {
	github?: { repos: string[]; permissions: Array<'contents:read' | 'contents:write' | 'pull_requests:write'> };
	filesystem?: { allow: string[] };
	network?: { allow: string[] };
}

export interface GuildRunContext {
	taskId: string;
	sessionId: string;
	/** Payload delivered by the trigger (e.g. the GitHub PR event). */
	trigger?: { kind: GuildTriggerKind; event?: string; payload?: Record<string, unknown> };
	log: (message: string, data?: Record<string, unknown>) => void;
}

export interface GuildRunResult {
	status: 'ok' | 'failed' | 'skipped';
	summary: string;
	/** Anything worth pasting into EXECUTION.md §4 — run tokens, PR URLs, offsets. */
	evidence: Record<string, unknown>;
}

export interface GuildAgentDefinition {
	name: string;
	/** G1 / G2 / G3 in EXECUTION.md §1. */
	requirementId: 'G1' | 'G2' | 'G3';
	description: string;
	triggers: GuildTrigger[];
	scope: GuildScope;
	run: (ctx: GuildRunContext) => Promise<GuildRunResult>;
}
