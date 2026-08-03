// Environment loading and validation for the Relay orchestration layer.
//
// The repo keeps a single .env at the root (see .env.example). RocketRide only
// substitutes variables prefixed with ROCKETRIDE_ inside .pipe files, so the
// pipeline-facing credentials are duplicated under that prefix on purpose.

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = resolve(here, '..', '..');
export const PIPELINE_DIR = resolve(REPO_ROOT, 'pipeline');
export const EVIDENCE_DIR = resolve(REPO_ROOT, 'evidence');

export const CAPTURE_PIPE = resolve(PIPELINE_DIR, 'relay-capture.pipe');
export const RESUME_PIPE = resolve(PIPELINE_DIR, 'relay-resume.pipe');

const envPath = resolve(REPO_ROOT, '.env');
if (existsSync(envPath)) {
	dotenv.config({ path: envPath });
}

function optional(name: string, fallback = ''): string {
	return process.env[name] ?? fallback;
}

export interface RelayConfig {
	rocketride: { uri: string; apikey: string };
	laserdata: { streamUrl: string; apiToken: string };
	falkordb: { host: string; port: number; username: string; password: string; graph: string };
	guild: { gatewayUrl: string; apiKey: string; workspaceId: string };
	slack: { webhookUrl: string };
	github: { token: string; targetRepo: string };
}

export const config: RelayConfig = {
	rocketride: {
		uri: optional('ROCKETRIDE_URI', 'https://api.rocketride.ai'),
		apikey: optional('ROCKETRIDE_APIKEY'),
	},
	laserdata: {
		streamUrl: optional('LASERDATA_STREAM_URL', optional('ROCKETRIDE_LASERDATA_STREAM_URL')),
		apiToken: optional('LASERDATA_API_TOKEN'),
	},
	falkordb: {
		host: optional('ROCKETRIDE_FALKORDB_HOST', 'localhost'),
		port: Number(optional('FALKORDB_PORT', '6379')),
		username: optional('ROCKETRIDE_FALKORDB_USERNAME'),
		password: optional('ROCKETRIDE_FALKORDB_PASSWORD'),
		graph: optional('ROCKETRIDE_FALKORDB_GRAPH', 'relay'),
	},
	guild: {
		gatewayUrl: optional('GUILD_GATEWAY_URL', 'https://gateway.guild.ai'),
		apiKey: optional('GUILD_API_KEY'),
		workspaceId: optional('GUILD_WORKSPACE_ID'),
	},
	slack: { webhookUrl: optional('SLACK_WEBHOOK_URL') },
	github: {
		token: optional('ROCKETRIDE_GITHUB_TOKEN', optional('GITHUB_TOKEN')),
		targetRepo: optional('ROCKETRIDE_TARGET_REPO'),
	},
};

/** Variables the .pipe files reference. Missing ones are left unsubstituted by the engine. */
export const PIPELINE_VARS = [
	'ROCKETRIDE_URI',
	'ROCKETRIDE_APIKEY',
	'ROCKETRIDE_OPENAI_KEY',
	'ROCKETRIDE_ANTHROPIC_KEY',
	'ROCKETRIDE_LASERDATA_STREAM_URL',
	'ROCKETRIDE_LASERDATA_URL_PATTERN',
	'ROCKETRIDE_SLACK_URL_PATTERN',
	'ROCKETRIDE_FALKORDB_HOST',
	'ROCKETRIDE_FALKORDB_USERNAME',
	'ROCKETRIDE_FALKORDB_PASSWORD',
	'ROCKETRIDE_FALKORDB_GRAPH',
	'ROCKETRIDE_GITHUB_TOKEN',
	'ROCKETRIDE_TARGET_REPO',
	'ROCKETRIDE_TARGET_TASK_ID',
] as const;

export function missingVars(names: readonly string[]): string[] {
	return names.filter((n) => !process.env[n]);
}
