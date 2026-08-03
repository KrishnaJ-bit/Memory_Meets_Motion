// FalkorDB F6 — agent write-back.
//
// Track 1 owns F1–F5 (the human-authored graph). Track 2 owns F6: the nodes the
// resume agent itself authors. Everything written here carries author:'agent' so
// the demo can show agent-authored nodes as visibly distinct from human ones.
//
// The R2 pipeline also writes back directly through the `tool_falkordb` node
// (allow_writes: true). This module is the out-of-pipeline path: used by the
// Guild agents and by the trace ingester when a run must be recorded even if the
// pipeline aborted mid-wave.

import { FalkorDB } from 'falkordb';
import { graphNameForTask as sharedGraphNameForTask } from '../../src/shared/graph-contract.js';
import { config } from './config.js';

export interface AgentStep {
	stepId: string;
	taskId: string;
	order: number;
	description: string;
	status: 'pending' | 'in_progress' | 'done' | 'failed';
}

export interface AgentDecision {
	decisionId: string;
	stepId: string;
	text: string;
	reasoning: string;
}

export interface WriteBackResult {
	graph: string;
	statements: number;
	nodesCreated: number;
}

/**
 * FalkorDB returns query stats as a string array, e.g. ["Nodes created: 2", ...].
 * Pull one counter out of it.
 */
function countFromMetadata(metadata: string[] | undefined, key: string): number {
	const line = metadata?.find((m) => m.startsWith(`${key}:`));
	if (!line) return 0;
	const value = Number(line.slice(key.length + 1).trim());
	return Number.isFinite(value) ? value : 0;
}

/**
 * Per-task graph (F5): one graph per active task, not one shared graph.
 *
 * This MUST match Track 1's `src/shared/graph-contract.ts`. An earlier version
 * computed `${prefix}:${taskId}` here, which meant the agent's F6 write-back
 * landed in a different graph than the F1 writes it was supposed to be closing
 * the loop on — the demo would have shown an empty agent contribution.
 */
export const graphNameForTask = sharedGraphNameForTask;

export class FalkorWriteBack {
	private db?: FalkorDB;

	async connect(): Promise<void> {
		if (this.db) return;
		this.db = await FalkorDB.connect({
			socket: { host: config.falkordb.host, port: config.falkordb.port },
			username: config.falkordb.username || undefined,
			password: config.falkordb.password || undefined,
		});
	}

	async close(): Promise<void> {
		await this.db?.close();
		this.db = undefined;
	}

	private graph(taskId: string) {
		if (!this.db) throw new Error('FalkorWriteBack.connect() must be called first');
		return this.db.selectGraph(graphNameForTask(taskId));
	}

	/**
	 * F6: MERGE the agent-authored Step/Decision subgraph for one resume run.
	 * MERGE only — never CREATE — so replaying the same run is idempotent.
	 */
	async writeAgentWork(params: {
		taskId: string;
		agentId: string;
		agentName: string;
		steps: AgentStep[];
		decisions: AgentDecision[];
		filesTouched?: string[];
	}): Promise<WriteBackResult> {
		const g = this.graph(params.taskId);
		let statements = 0;
		let nodesCreated = 0;

		const run = async (cypher: string, cfg: Record<string, unknown>) => {
			const reply = await g.query(cypher, { params: cfg as never });
			statements += 1;
			nodesCreated += countFromMetadata(reply.metadata, 'Nodes created');
		};

		await run(
			`MERGE (a:Agent {id: $agent_id})
			 SET a.name = $agent_name
			 MERGE (t:Task {id: $task_id})
			 MERGE (t)-[:RESUMED_BY]->(a)`,
			{ agent_id: params.agentId, agent_name: params.agentName, task_id: params.taskId }
		);

		for (const step of params.steps) {
			await run(
				`MERGE (st:Step {id: $step_id})
				 SET st.order = $order,
				     st.description = $description,
				     st.status = $status,
				     st.author = 'agent'
				 MERGE (t:Task {id: $task_id})
				 MERGE (a:Agent {id: $agent_id})
				 MERGE (st)-[:AUTHORED_BY]->(a)`,
				{
					step_id: step.stepId,
					order: step.order,
					description: step.description,
					status: step.status,
					task_id: params.taskId,
					agent_id: params.agentId,
				}
			);
		}

		for (const decision of params.decisions) {
			await run(
				`MERGE (d:Decision {id: $decision_id})
				 SET d.text = $text,
				     d.reasoning = $reasoning,
				     d.author = 'agent'
				 MERGE (st:Step {id: $step_id})
				 MERGE (d)-[:MADE_DURING]->(st)`,
				{
					decision_id: decision.decisionId,
					text: decision.text,
					reasoning: decision.reasoning,
					step_id: decision.stepId,
				}
			);
		}

		for (const path of params.filesTouched ?? []) {
			await run(
				`MERGE (f:File {path: $path})
				 WITH f
				 MATCH (st:Step {author: 'agent'})
				 WHERE st.id IN $step_ids
				 MERGE (st)-[:MODIFIES]->(f)`,
				{ path, step_ids: params.steps.map((s) => s.stepId) }
			);
		}

		return { graph: graphNameForTask(params.taskId), statements, nodesCreated };
	}

	/** Evidence query: proves agent-authored nodes exist and are distinguishable (F6). */
	async readAgentAuthored(taskId: string): Promise<unknown[]> {
		const g = this.graph(taskId);
		const reply = await g.roQuery<unknown>(
			`MATCH (n)
			 WHERE n.author = 'agent'
			 RETURN labels(n) AS labels, n.id AS id, n.description AS description, n.text AS text`
		);
		return reply.data ?? [];
	}
}

export const falkorWriteBack = new FalkorWriteBack();
