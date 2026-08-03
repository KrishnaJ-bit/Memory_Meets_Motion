// Relay's three Guild.ai agents (EXECUTION.md §1 → G1, G2, G3).
//
// Each `run` is the real body, not a stub: G1 and G2 drive the RocketRide
// pipelines, G3 reviews the PR that G2's pipeline opened. They talk to Guild
// only through GuildTransport (client.ts), so none of this depends on an SDK
// whose API could not be confirmed.

import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { falkorWriteBack, graphNameForTask } from '../falkordb.js';
import { ScopeViolationError, github } from '../github.js';
import { STREAM_L1, laserdata } from '../laserdata.js';
import { requestResume, sendEventBatch, startCapturePipeline, startResumePipeline, stop } from '../rocketride.js';
import { TraceIngester } from '../trace_ingest.js';
import type { GuildAgentDefinition, GuildRunContext, GuildRunResult } from './types.js';

/**
 * R1's agent is told to answer with `{ "decisions": [...] }`, but an LLM answer
 * is a string until proven otherwise. Pull the array out without trusting shape.
 */
function extractDecisions(answers: unknown): unknown[] {
	const first = Array.isArray(answers) ? answers[0] : answers;
	if (first == null) return [];

	let parsed: unknown = first;
	if (typeof first === 'string') {
		try {
			parsed = JSON.parse(first);
		} catch {
			return [];
		}
	}
	if (Array.isArray(parsed)) return parsed;
	const decisions = (parsed as { decisions?: unknown } | null)?.decisions;
	return Array.isArray(decisions) ? decisions : [];
}

/** G1 — compress raw L1 events into structured decisions via the R1 pipeline. */
export const contextSummarizer: GuildAgentDefinition = {
	name: 'context-summarizer',
	requirementId: 'G1',
	description:
		'Reads a batch of raw LaserData session events, runs them through the RocketRide relay-capture pipeline, and emits structured decisions to relay.graph.mutations before the graph write.',
	triggers: [
		{ kind: 'scheduled', cron: '*/2 * * * *', description: 'Compress the event tail every two minutes during a live session.' },
		{ kind: 'on-batch', description: 'Fire as soon as the L1 consumer has buffered a full batch.' },
	],
	scope: {
		network: { allow: ['laserdata', 'rocketride'] },
		filesystem: { allow: [] },
	},
	async run(ctx: GuildRunContext): Promise<GuildRunResult> {
		const offset = Number((ctx.trigger?.payload?.offset as number | undefined) ?? 0);
		ctx.log('replaying L1 tail', { offset });

		const { events, offsets } = await laserdata.replay(STREAM_L1, offset, 200);
		if (events.length === 0) {
			return { status: 'skipped', summary: `No L1 events at offset ${offset}.`, evidence: { offset } };
		}

		const ingester = new TraceIngester(
			{ taskId: ctx.taskId, sessionId: ctx.sessionId, runToken: `pending-${randomUUID()}` },
			laserdata
		);
		const handle = await startCapturePipeline({ traceLevel: 'summary', onEvent: ingester.handleEvent });

		try {
			ctx.log('R1 started', { token: handle.token, pipeline: handle.filepath });
			const result = await sendEventBatch(handle, events);

			// The pipeline returns decisions; publishing them to L2 is ours to do —
			// LaserData is Iggy over TCP, so no agent tool inside the pipeline can
			// reach it.
			const decisions = extractDecisions(result?.answers);
			let published = 0;
			if (decisions.length > 0) {
				published = await laserdata.publishDecisions(ctx.taskId, ctx.sessionId, decisions);
				ctx.log('published decisions to L2', { count: published });
			}

			return {
				status: 'ok',
				summary: `Summarized ${events.length} L1 events into ${decisions.length} decision(s); ${published} published to L2.`,
				evidence: {
					pipeline: 'relay-capture',
					run_token: handle.token,
					l1_offset: offset,
					l1_next_offsets: Object.fromEntries([...offsets].map(([p, o]) => [p, o.toString()])),
					events_read: events.length,
					decisions_published: published,
					result_types: result?.result_types ?? null,
					answers: result?.answers ?? null,
					trace: ingester.summary(),
				},
			};
		} finally {
			await stop(handle);
		}
	},
};

/** G2 — the governed resume agent: runs R2 and writes the result back to the graph. */
export const relayResume: GuildAgentDefinition = {
	name: 'relay-resume',
	requirementId: 'G2',
	description:
		'Scoped resume agent. Rebuilds task context from FalkorDB plus the LaserData replay, runs the RocketRide relay-resume pipeline to finish the work, and MERGEs the agent-authored Step/Decision nodes back into the per-task graph (F6).',
	triggers: [
		{ kind: 'manual', description: 'Demo button — operator triggers the resume on stage.' },
		{ kind: 'idle-timeout', idleSeconds: 900, description: 'Real path — fires after 15 minutes of session inactivity.' },
	],
	scope: {
		github: { repos: [config.github.targetRepo].filter(Boolean), permissions: ['contents:read', 'contents:write', 'pull_requests:write'] },
		filesystem: { allow: [] },
		network: { allow: ['laserdata', 'falkordb', 'rocketride', 'api.github.com', 'hooks.slack.com'] },
	},
	async run(ctx: GuildRunContext): Promise<GuildRunResult> {
		// Governance gate: refuse to run at all if the credentials reach past the target repo.
		try {
			const scope = await github.assertScopedToTargetRepo();
			ctx.log('credential scope verified', { repos: scope.repos });
		} catch (error) {
			if (error instanceof ScopeViolationError) {
				return {
					status: 'failed',
					summary: `Refused to run: ${error.message}`,
					evidence: { scope_check: 'failed', reason: error.message },
				};
			}
			throw error;
		}

		const replayOffset = (ctx.trigger?.payload?.replay_offset as number | string | undefined) ?? 0;
		const goal = (ctx.trigger?.payload?.goal as string | undefined) ?? 'Finish the interrupted task.';

		// ReplayEventTail (L1 replay-by-offset). This runs here, not inside the
		// pipeline: LaserData speaks Iggy over TCP, which no RocketRide tool node
		// can reach. The tail is handed to R2 as question context.
		const { events: eventTail } = await laserdata.replay(STREAM_L1, Number(replayOffset) || 0, 200);
		ctx.log('replayed L1 tail', { offset: replayOffset, events: eventTail.length });

		const ingester = new TraceIngester(
			{ taskId: ctx.taskId, sessionId: ctx.sessionId, runToken: `pending-${randomUUID()}` },
			laserdata
		);
		const handle = await startResumePipeline({ traceLevel: 'summary', onEvent: ingester.handleEvent });

		try {
			ctx.log('R2 started', { token: handle.token });
			const result = await requestResume(handle, {
				taskId: ctx.taskId,
				sessionId: ctx.sessionId,
				goal,
				replayOffset,
				eventTail,
			});

			const answer = result.answers?.[0];
			ctx.log('R2 answered', { hasAnswer: Boolean(answer) });

			// F6 — record the run itself as agent-authored graph state. The pipeline's
			// falkordb tool writes the detailed nodes; this guarantees at least the run
			// is in the graph even if the agent aborted before its own write-back.
			let writeBack: unknown = null;
			try {
				await falkorWriteBack.connect();
				writeBack = await falkorWriteBack.writeAgentWork({
					taskId: ctx.taskId,
					agentId: 'relay-resume',
					agentName: 'Relay Resume Agent',
					steps: [
						{
							stepId: `${ctx.taskId}:resume:${handle.token}`,
							taskId: ctx.taskId,
							order: 1,
							description: `Ran relay-resume pipeline (token ${handle.token}).`,
							status: answer ? 'done' : 'failed',
						},
					],
					decisions: [
						{
							decisionId: `${ctx.taskId}:decision:${handle.token}`,
							stepId: `${ctx.taskId}:resume:${handle.token}`,
							text: typeof answer === 'string' ? answer.slice(0, 2000) : 'No answer returned by R2.',
							reasoning: `Resumed from LaserData offset ${replayOffset} against graph ${graphNameForTask(ctx.taskId)}.`,
						},
					],
				});
			} finally {
				await falkorWriteBack.close();
			}

			return {
				status: answer ? 'ok' : 'failed',
				summary: answer ? 'Resume pipeline completed.' : 'Resume pipeline returned no answer.',
				evidence: {
					pipeline: 'relay-resume',
					run_token: handle.token,
					replay_offset: replayOffset,
					event_tail_size: eventTail.length,
					graph: graphNameForTask(ctx.taskId),
					f6_write_back: writeBack,
					answer: answer ?? null,
					trace: ingester.summary(),
				},
			};
		} finally {
			await stop(handle);
		}
	},
};

/**
 * G3 — reviews the PR that G2 opened, before a human sees it.
 *
 * Deliberately not another LLM pass: it cross-checks the PR against the memory
 * graph (does it touch a file with an unresolved Blocker?) and against the PR
 * body's own claims (did it say tests ran?), which is a check a second LLM
 * reading the same diff cannot make.
 */
export const prRiskReview: GuildAgentDefinition = {
	name: 'pr-risk-review',
	requirementId: 'G3',
	description:
		"Reviews the resume agent's own PR: flags oversized diffs, files still carrying unresolved blockers in the memory graph, and PRs that never state a test result. Posts the review as a comment.",
	triggers: [{ kind: 'webhook-event', event: 'github.pr.opened', description: "Fires on the PR opened by relay-resume." }],
	scope: {
		github: { repos: [config.github.targetRepo].filter(Boolean), permissions: ['contents:read', 'pull_requests:write'] },
		network: { allow: ['api.github.com', 'falkordb', 'laserdata'] },
	},
	async run(ctx: GuildRunContext): Promise<GuildRunResult> {
		const prNumber = Number(ctx.trigger?.payload?.pull_request_number ?? ctx.trigger?.payload?.number);
		if (!Number.isFinite(prNumber)) {
			return { status: 'skipped', summary: 'Trigger carried no pull request number.', evidence: {} };
		}

		const pr = await github.getPullRequest(prNumber);
		const files = await github.listChangedFiles(prNumber);
		ctx.log('reviewing PR', { number: pr.number, files: files.length });

		const risks: string[] = [];

		const churn = pr.additions + pr.deletions;
		if (churn > 400) {
			risks.push(`Large diff for an agent-authored change: ${churn} lines across ${pr.changedFiles} files.`);
		}

		if (!/test/i.test(pr.body ?? '')) {
			risks.push('PR body does not state a test result. The resume agent is required to report which tests ran.');
		}

		// Cross-check against the memory graph: unresolved blockers on touched files.
		let blockedFiles: string[] = [];
		try {
			await falkorWriteBack.connect();
			const authored = await falkorWriteBack.readAgentAuthored(ctx.taskId);
			ctx.log('graph cross-check', { agentAuthoredNodes: authored.length });
			blockedFiles = files.map((f) => f.filename).filter((name) => JSON.stringify(authored).includes(name));
			if (blockedFiles.length > 0) {
				risks.push(`Files referenced by agent-authored graph nodes: ${blockedFiles.join(', ')} — confirm the blocker was actually resolved.`);
			}
		} catch (error) {
			risks.push(`Graph cross-check unavailable: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			await falkorWriteBack.close();
		}

		const verdict = risks.length === 0 ? 'No blocking risks found.' : `${risks.length} item(s) need a human look.`;
		const comment = [
			'### Relay PR risk review (automated, agent `pr-risk-review`)',
			'',
			verdict,
			'',
			...risks.map((r) => `- ${r}`),
			'',
			`_Reviewed ${files.length} changed file(s) on branch \`${pr.headRef}\`._`,
		].join('\n');

		const posted = await github.postReviewComment(prNumber, comment);

		await laserdata
			.publishAgentAction(ctx.taskId, ctx.sessionId, {
				source: 'guild.pr-risk-review',
				pr_number: prNumber,
				pr_url: pr.htmlUrl,
				risks,
				comment_url: posted.html_url,
			})
			.catch(() => undefined);

		return {
			status: 'ok',
			summary: verdict,
			evidence: { pr_number: prNumber, pr_url: pr.htmlUrl, comment_url: posted.html_url, risks },
		};
	},
};

/**
 * The agents as they exist on Guild's server, published with the Guild CLI on
 * 2026-08-03 under workspace `krishnaj-bit/relay` (019fc961-c58a-3bb9-0000-0eecc46e8c11).
 *
 * Republished under a fresh account+workspace the same day: the original
 * `krishivsagrawal/relay` workspace belonged to a different Guild account than
 * the one authenticated on this machine, so its agents (same source, same
 * ids referenced in `agents/README.md`'s history) were not reachable here.
 *
 * The definitions above are the local orchestration contract — what triggers
 * them, what scope they get, and what they do when this process drives them.
 * These ids are the same agents hosted by Guild, where their system prompts and
 * audited sessions live (`agents/<name>/agent.ts`).
 */
export const GUILD_AGENT_IDS: Record<string, string> = {
	'context-summarizer': '019fc96e-bf4e-726e-0000-3946e652ce48',
	'relay-resume': '019fc96e-e112-726e-0000-ee79e865fc10',
	'pr-risk-review': '019fc96e-eb5e-726e-0000-a8d76d289353',
};

export const GUILD_WORKSPACE = {
	id: '019fc961-c58a-3bb9-0000-0eecc46e8c11',
	slug: 'krishnaj-bit/relay',
};

export const agents: GuildAgentDefinition[] = [contextSummarizer, relayResume, prRiskReview];

export function agentByName(name: string): GuildAgentDefinition | undefined {
	return agents.find((a) => a.name === name);
}
