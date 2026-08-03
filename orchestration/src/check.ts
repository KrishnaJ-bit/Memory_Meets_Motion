// Setup checker for Track 2 (required by ROCKETRIDE_README.md).
//
//   npm run check            offline checks only
//   npm run check -- --live  also hits RocketRide, FalkorDB, LaserData, GitHub
//
// Exits non-zero if anything that would break the demo is wrong.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { CAPTURE_PIPE, PIPELINE_VARS, REPO_ROOT, RESUME_PIPE, config, missingVars } from './config.js';
import { lintPipeline, findCatalog } from './pipeline_lint.js';
import { flag } from './cli.js';

const PASS = '  ok  ';
const FAIL = ' FAIL ';
const WARN = ' warn ';

let failures = 0;

function report(status: string, label: string, detail = ''): void {
	if (status === FAIL) failures += 1;
	console.log(`[${status}] ${label}${detail ? ` — ${detail}` : ''}`);
}

function checkEnvFile(): void {
	const envPath = resolve(REPO_ROOT, '.env');
	if (existsSync(envPath)) {
		report(PASS, '.env present', envPath);
	} else {
		report(FAIL, '.env missing', `copy .env.example to ${envPath}`);
	}

	const missing = missingVars(PIPELINE_VARS);
	if (missing.length === 0) {
		report(PASS, 'pipeline variables set', `${PIPELINE_VARS.length} ROCKETRIDE_* vars`);
	} else {
		report(FAIL, 'pipeline variables missing', missing.join(', '));
	}
}

function checkPipelines(): void {
	const catalog = findCatalog();
	report(catalog ? PASS : WARN, 'services catalog', catalog ?? 'not found — lane checks skipped');

	for (const file of [CAPTURE_PIPE, RESUME_PIPE]) {
		if (!existsSync(file)) {
			report(FAIL, `pipeline ${file}`, 'missing');
			continue;
		}
		const result = lintPipeline(file);
		const name = file.replace(`${REPO_ROOT}/`, '');
		if (result.errors.length === 0) {
			report(PASS, `pipeline ${name}`, `${result.envVars.length} env refs`);
		} else {
			report(FAIL, `pipeline ${name}`, `${result.errors.length} error(s)`);
			for (const error of result.errors) console.log(`         - ${error}`);
		}
		for (const warning of result.warnings) console.log(`         ~ ${warning}`);

		const unset = result.envVars.filter((v) => !process.env[v]);
		if (unset.length > 0) {
			report(WARN, `  ${name} unset vars`, unset.join(', '));
		}
	}
}

function checkCredentials(): void {
	report(config.rocketride.apikey ? PASS : FAIL, 'RocketRide credentials', config.rocketride.uri);
	report(config.laserdata.streamUrl ? PASS : FAIL, 'LaserData stream URL', config.laserdata.streamUrl || 'unset');
	report(config.falkordb.host ? PASS : FAIL, 'FalkorDB host', `${config.falkordb.host}:${config.falkordb.port}`);
	report(
		config.guild.apiKey && config.guild.workspaceId ? PASS : WARN,
		'Guild credentials',
		config.guild.apiKey ? config.guild.gatewayUrl : 'unset — agents will use the local audit transport'
	);
	report(config.github.targetRepo ? PASS : FAIL, 'GitHub target repo', config.github.targetRepo || 'unset');
	report(config.slack.webhookUrl ? PASS : WARN, 'Slack webhook', config.slack.webhookUrl ? 'set' : 'unset — NotifySlack will no-op');
}

async function checkLive(): Promise<void> {
	console.log('\nLive checks:');

	// RocketRide: connect and server-validate both pipelines.
	try {
		const { RocketRideClient } = await import('rocketride');
		const client = new RocketRideClient({ uri: config.rocketride.uri, auth: config.rocketride.apikey });
		await client.connect();
		report(PASS, 'RocketRide connect', config.rocketride.uri);

		for (const file of [CAPTURE_PIPE, RESUME_PIPE]) {
			const { readFileSync } = await import('node:fs');
			const pipeline = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
			const result = await client.validate({ pipeline });
			const name = file.replace(`${REPO_ROOT}/`, '');
			if ((result.errors ?? []).length === 0) {
				report(PASS, `server validate ${name}`, `${(result.warnings ?? []).length} warning(s)`);
			} else {
				report(FAIL, `server validate ${name}`, JSON.stringify(result.errors));
			}
		}
		await client.disconnect();
	} catch (error) {
		report(FAIL, 'RocketRide', error instanceof Error ? error.message : String(error));
	}

	// FalkorDB reachability.
	try {
		const { FalkorDB } = await import('falkordb');
		const db = await FalkorDB.connect({
			socket: { host: config.falkordb.host, port: config.falkordb.port },
			username: config.falkordb.username || undefined,
			password: config.falkordb.password || undefined,
		});
		const graph = db.selectGraph(`${config.falkordb.graph}:healthcheck`);
		await graph.query('RETURN 1');
		await db.close();
		report(PASS, 'FalkorDB reachable', `${config.falkordb.host}:${config.falkordb.port}`);
	} catch (error) {
		report(FAIL, 'FalkorDB', error instanceof Error ? error.message : String(error));
	}

	// LaserData L3 round-trip.
	try {
		const { laserdata, STREAM_L3 } = await import('./laserdata.js');
		const result = await laserdata.publish(STREAM_L3, {
			session_id: 'healthcheck',
			task_id: 'healthcheck',
			event_type: 'agent_action',
			timestamp: new Date().toISOString(),
			payload: { source: 'orchestration.check' },
		});
		report(PASS, 'LaserData L3 publish', `offset ${result.offset ?? 'n/a'}`);
	} catch (error) {
		report(FAIL, 'LaserData', error instanceof Error ? error.message : String(error));
	}

	// GitHub credential scoping — the G2 governance gate.
	try {
		const { github } = await import('./github.js');
		const scope = await github.assertScopedToTargetRepo();
		report(PASS, 'GitHub token scope', scope.repos.join(', '));
	} catch (error) {
		report(FAIL, 'GitHub token scope', error instanceof Error ? error.message : String(error));
	}
}

async function main(): Promise<void> {
	console.log('Relay Track 2 — orchestration + pipeline check\n');
	checkEnvFile();
	checkPipelines();
	checkCredentials();

	if (flag('live')) {
		await checkLive();
	} else {
		console.log('\n(run with --live to also hit RocketRide, FalkorDB, LaserData and GitHub)');
	}

	console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}`);
	process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
