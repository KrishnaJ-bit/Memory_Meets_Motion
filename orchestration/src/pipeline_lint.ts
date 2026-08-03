// Catalog-driven validator for the Relay .pipe files.
//
// RocketRide's own `client.validate()` is the authority, but it needs a live
// server. This runs offline against .rocketride/services-catalog.json and the
// rules in ROCKETRIDE_PIPELINE_RULES.md / ROCKETRIDE_COMMON_MISTAKES.md, so a
// broken pipeline is caught before anyone burns demo time on it.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT } from './config.js';

interface CatalogEntry {
	name: string;
	classType: string[];
	lanes: Record<string, string[]>;
	invoke?: Record<string, { min?: number; max?: number }>;
}

interface Component {
	id: string;
	provider: string;
	config?: Record<string, unknown>;
	input?: Array<{ lane: string; from: string }>;
	control?: Array<{ classType: string; from: string }>;
}

interface Pipeline {
	components: Component[];
	project_id: string;
	viewport?: unknown;
	version?: number;
	source?: string;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ENV_REF = /\$\{(ROCKETRIDE_[A-Z0-9_]+)\}/g;

export interface LintResult {
	file: string;
	errors: string[];
	warnings: string[];
	envVars: string[];
}

/** The extension writes .rocketride/ next to the workspace, which may sit above the repo. */
export function findCatalog(): string | undefined {
	for (const candidate of [
		resolve(REPO_ROOT, '.rocketride', 'services-catalog.json'),
		resolve(REPO_ROOT, '..', '.rocketride', 'services-catalog.json'),
	]) {
		if (existsSync(candidate)) return candidate;
	}
	return undefined;
}

export function lintPipeline(file: string): LintResult {
	const errors: string[] = [];
	const warnings: string[] = [];
	const raw = readFileSync(file, 'utf8');

	let pipeline: Pipeline;
	try {
		pipeline = JSON.parse(raw) as Pipeline;
	} catch (error) {
		return { file, errors: [`invalid JSON: ${String(error)}`], warnings, envVars: [] };
	}

	// Field order / required fields (COMMON_MISTAKES 2, 3, 4).
	const keys = Object.keys(pipeline);
	if (keys[0] !== 'components') errors.push(`"components" must be the first field (found "${keys[0]}")`);
	if (!file.endsWith('.pipe')) errors.push('pipeline files must use the .pipe extension');
	if (!GUID.test(pipeline.project_id ?? '')) errors.push(`project_id must be a literal lowercase GUID (got "${pipeline.project_id}")`);
	if (!pipeline.viewport) warnings.push('viewport missing — the editor will add a default');
	if (pipeline.version !== 1) errors.push('version must be 1');

	const catalogPath = findCatalog();
	const catalog: CatalogEntry[] = catalogPath ? (JSON.parse(readFileSync(catalogPath, 'utf8')) as CatalogEntry[]) : [];
	const byName = new Map(catalog.map((c) => [c.name, c]));
	if (!catalogPath) warnings.push('services-catalog.json not found — provider and lane checks skipped');

	const ids = new Set<string>();
	const referenced = new Set<string>();

	for (const component of pipeline.components ?? []) {
		if (ids.has(component.id)) errors.push(`duplicate component id "${component.id}"`);
		ids.add(component.id);

		const entry = byName.get(component.provider);
		if (catalogPath && !entry) {
			errors.push(`unknown provider "${component.provider}" on "${component.id}"`);
			continue;
		}

		const isSource = entry?.classType.includes('source') ?? false;
		const isTool = entry?.classType.includes('tool') && Object.keys(entry.lanes ?? {}).length === 0;

		// Source config must carry hideForm/mode/parameters/type (COMMON_MISTAKES 5).
		if (isSource) {
			for (const field of ['hideForm', 'mode', 'parameters', 'type']) {
				if (!(field in (component.config ?? {}))) {
					errors.push(`source "${component.id}" config is missing "${field}"`);
				}
			}
			if (component.input?.length) errors.push(`source "${component.id}" must not have an input array`);
		}

		if (component.provider === 'memory_internal' && (component.config as { type?: string } | undefined)?.type !== 'memory_internal') {
			errors.push(`"${component.id}" config must include { "type": "memory_internal" }`);
		}

		// Non-source, non-control nodes need inputs (COMMON_MISTAKES 16/18).
		const controlled = (component.control?.length ?? 0) > 0;
		if (!isSource && !controlled && !(component.input?.length ?? 0)) {
			errors.push(`"${component.id}" has neither input lanes nor a control connection (orphaned)`);
		}
		if (isTool && !controlled) {
			errors.push(`tool "${component.id}" must declare a control entry naming its invoker`);
		}

		for (const input of component.input ?? []) {
			referenced.add(input.from);
			const upstream = (pipeline.components ?? []).find((c) => c.id === input.from);
			if (!upstream) {
				errors.push(`"${component.id}" reads from unknown component "${input.from}"`);
				continue;
			}
			if (!catalogPath) continue;

			const upstreamEntry = byName.get(upstream.provider);
			const upstreamOutputs = new Set(Object.values(upstreamEntry?.lanes ?? {}).flat());
			const isUpstreamSource = upstreamEntry?.classType.includes('source') ?? false;
			if (!upstreamOutputs.has(input.lane)) {
				errors.push(
					`lane mismatch: "${upstream.id}" (${upstream.provider}) does not output "${input.lane}" ` +
						`[outputs: ${[...upstreamOutputs].join(', ') || 'none'}]`
				);
			} else if (!isUpstreamSource && !(input.lane in (entry?.lanes ?? {}))) {
				errors.push(
					`lane mismatch: "${component.id}" (${component.provider}) does not accept "${input.lane}" ` +
						`[accepts: ${Object.keys(entry?.lanes ?? {}).join(', ') || 'none'}]`
				);
			}
		}

		for (const control of component.control ?? []) {
			referenced.add(control.from);
			const invoker = (pipeline.components ?? []).find((c) => c.id === control.from);
			if (!invoker) {
				errors.push(`"${component.id}" declares control from unknown component "${control.from}"`);
				continue;
			}
			const invokerEntry = byName.get(invoker.provider);
			if (catalogPath && !invokerEntry?.invoke?.[control.classType]) {
				errors.push(`"${invoker.id}" (${invoker.provider}) does not invoke classType "${control.classType}"`);
			}
		}
	}

	// invoke min/max satisfied? (agent_rocketride needs exactly 1 llm and 1 memory)
	if (catalogPath) {
		for (const component of pipeline.components ?? []) {
			const entry = byName.get(component.provider);
			for (const [classType, rule] of Object.entries(entry?.invoke ?? {})) {
				const attached = (pipeline.components ?? []).filter((c) =>
					(c.control ?? []).some((ctrl) => ctrl.from === component.id && ctrl.classType === classType)
				).length;
				if (rule.min !== undefined && attached < rule.min) {
					errors.push(`"${component.id}" needs at least ${rule.min} ${classType} connection(s), found ${attached}`);
				}
				if (rule.max !== undefined && attached > rule.max) {
					errors.push(`"${component.id}" accepts at most ${rule.max} ${classType} connection(s), found ${attached}`);
				}
			}
		}
	}

	const envVars = [...new Set([...raw.matchAll(ENV_REF)].map((m) => m[1] ?? ''))].filter(Boolean).sort();
	return { file, errors, warnings, envVars };
}
