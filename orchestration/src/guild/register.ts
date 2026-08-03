// Registers the three Relay agents and both trigger types with Guild.
//
//   npm run guild:register
//
// Prints the agent ids and trigger ids to paste into EXECUTION.md §4. With no
// Guild credentials in .env it registers against the local transport instead, so
// the trigger inventory is still reviewable before the account exists.

import { agents } from './agents.js';
import { resolveTransport } from './client.js';

async function main(): Promise<void> {
	const transport = resolveTransport();
	console.log(`Registering ${agents.length} agents via the ${transport.kind} transport.\n`);

	for (const agent of agents) {
		const { agentId } = await transport.registerAgent(agent);
		console.log(`${agent.requirementId}  ${agent.name}`);
		console.log(`     agentId: ${agentId}`);
		console.log(`     scope:   ${JSON.stringify(agent.scope)}`);

		for (const trigger of agent.triggers) {
			const { triggerId } = await transport.registerTrigger(agent.name, trigger);
			console.log(`     trigger: ${trigger.kind}${trigger.event ? ` (${trigger.event})` : ''} -> ${triggerId}`);
		}
		console.log();
	}

	if (transport.kind === 'local') {
		console.log('NOTE: GUILD_API_KEY / GUILD_WORKSPACE_ID are unset, so nothing was registered');
		console.log('with Guild itself. Session records were written to evidence/guild-sessions.jsonl.');
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
