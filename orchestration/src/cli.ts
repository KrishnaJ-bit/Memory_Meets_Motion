/** `--name value` argument lookup for the orchestration entry points. */
export function arg(name: string): string | undefined {
	const index = process.argv.indexOf(`--${name}`);
	if (index === -1) return undefined;
	const value = process.argv[index + 1];
	return value?.startsWith('--') ? undefined : value;
}

export function flag(name: string): boolean {
	return process.argv.includes(`--${name}`);
}
