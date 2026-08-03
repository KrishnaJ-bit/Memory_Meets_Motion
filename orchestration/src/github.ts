// Minimal GitHub REST helper used by the Guild agents.
//
// The R2 pipeline opens the PR through RocketRide's `tool_github` node. This
// module covers what the *governance* layer needs: proving the resume agent's
// token is scoped to the target repo only, and letting the PR-risk-review agent
// read and comment on the PR the resume agent opened.

import { config } from './config.js';

const API = 'https://api.github.com';

export interface PullRequestSummary {
	number: number;
	title: string;
	body: string | null;
	htmlUrl: string;
	headRef: string;
	changedFiles: number;
	additions: number;
	deletions: number;
}

export interface ChangedFile {
	filename: string;
	status: string;
	additions: number;
	deletions: number;
}

export class GitHubError extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message);
		this.name = 'GitHubError';
	}
}

export class ScopeViolationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ScopeViolationError';
	}
}

export class GitHubClient {
	constructor(
		private readonly token = config.github.token,
		private readonly repo = config.github.targetRepo
	) {}

	get configured(): boolean {
		return Boolean(this.token && this.repo);
	}

	private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
		if (!this.token) throw new GitHubError('No GitHub token configured', 401);
		const res = await fetch(`${API}${path}`, {
			...init,
			headers: {
				accept: 'application/vnd.github+json',
				authorization: `Bearer ${this.token}`,
				'x-github-api-version': '2022-11-28',
				...(init.headers as Record<string, string> | undefined),
			},
		});
		if (!res.ok) {
			throw new GitHubError(`${init.method ?? 'GET'} ${path} failed: ${res.status} ${await res.text()}`, res.status);
		}
		return (await res.json()) as T;
	}

	/**
	 * Governance gate for G2.
	 *
	 * The original version of this check called `/installation/repositories` to
	 * enumerate every repo the token could reach. That endpoint only exists for
	 * GitHub App installation tokens — verified empirically on 2026-08-03 against
	 * a real fine-grained PAT (scoped, in the GitHub UI, to this repo only): the
	 * endpoint 403s, and no PAT of any kind can ever pass that check. Worse,
	 * `/user/repos` (the obvious alternative) is not a reliable negative signal
	 * either — it listed a second repo the same user owns even though the token
	 * was scoped to just this one, because that endpoint reflects what the
	 * *authenticated user* owns, not what the *token* is restricted to. GitHub's
	 * REST API has no endpoint that reports a fine-grained PAT's own repo
	 * allowlist back to itself.
	 *
	 * So this checks what is actually provable — the token can read/write the
	 * target repo — and leans on a stronger, code-level guarantee instead of a
	 * token-introspection one: every method on this class that touches GitHub
	 * (`getPullRequest`, `listChangedFiles`, `postReviewComment`, `createPullRequest`)
	 * is hard-wired to `this.repo` and accepts no repo parameter from agent
	 * output, so even a broadly-scoped token cannot make this code touch a
	 * different repository.
	 */
	async assertScopedToTargetRepo(): Promise<{ repos: string[] }> {
		if (!this.repo) {
			throw new ScopeViolationError('ROCKETRIDE_TARGET_REPO is unset — refusing to run an unscoped agent.');
		}

		let body: { permissions?: { push?: boolean }; full_name?: string };
		try {
			body = await this.request<{ permissions?: { push?: boolean }; full_name?: string }>(`/repos/${this.repo}`);
		} catch (error) {
			throw new ScopeViolationError(
				`Token cannot read the target repo ${this.repo}: ${error instanceof Error ? error.message : String(error)}`
			);
		}

		if (!body.permissions?.push) {
			throw new ScopeViolationError(`Token can read ${this.repo} but lacks push access — cannot open a PR.`);
		}

		return { repos: [body.full_name ?? this.repo] };
	}

	async getPullRequest(number: number): Promise<PullRequestSummary> {
		const pr = await this.request<{
			number: number;
			title: string;
			body: string | null;
			html_url: string;
			head: { ref: string };
			changed_files: number;
			additions: number;
			deletions: number;
		}>(`/repos/${this.repo}/pulls/${number}`);

		return {
			number: pr.number,
			title: pr.title,
			body: pr.body,
			htmlUrl: pr.html_url,
			headRef: pr.head.ref,
			changedFiles: pr.changed_files,
			additions: pr.additions,
			deletions: pr.deletions,
		};
	}

	async listChangedFiles(number: number): Promise<ChangedFile[]> {
		return this.request<ChangedFile[]>(`/repos/${this.repo}/pulls/${number}/files?per_page=100`);
	}

	async postReviewComment(number: number, body: string): Promise<{ id: number; html_url: string }> {
		return this.request<{ id: number; html_url: string }>(`/repos/${this.repo}/issues/${number}/comments`, {
			method: 'POST',
			body: JSON.stringify({ body }),
		});
	}

	/**
	 * Opens a real PR: branch off the default branch, commit each file's new
	 * content via the Contents API (one commit per file — this repo's demo patch
	 * is a single file, and the Contents API is simpler and safer than building a
	 * tree/commit by hand for that case), then open the PR against the default
	 * branch. Used by the resume flow only *after* the human-in-the-loop
	 * approval gate — never called automatically.
	 */
	async createPullRequest(params: {
		branchName: string;
		title: string;
		body: string;
		files: Array<{ path: string; content: string }>;
		commitMessage: string;
	}): Promise<PullRequestSummary> {
		const repoInfo = await this.request<{ default_branch: string }>(`/repos/${this.repo}`);
		const baseBranch = repoInfo.default_branch;

		const baseRef = await this.request<{ object: { sha: string } }>(`/repos/${this.repo}/git/ref/heads/${baseBranch}`);
		const baseSha = baseRef.object.sha;

		// Re-create the branch if a previous rehearsal left it behind, so reruns don't 422.
		try {
			await this.request(`/repos/${this.repo}/git/refs/heads/${params.branchName}`, { method: 'DELETE' });
		} catch {
			// Branch did not exist — expected on a first run.
		}
		await this.request(`/repos/${this.repo}/git/refs`, {
			method: 'POST',
			body: JSON.stringify({ ref: `refs/heads/${params.branchName}`, sha: baseSha }),
		});

		for (const file of params.files) {
			let existingSha: string | undefined;
			try {
				const existing = await this.request<{ sha: string }>(
					`/repos/${this.repo}/contents/${file.path}?ref=${params.branchName}`
				);
				existingSha = existing.sha;
			} catch {
				// New file — no existing blob to overwrite.
			}
			await this.request(`/repos/${this.repo}/contents/${file.path}`, {
				method: 'PUT',
				body: JSON.stringify({
					message: params.commitMessage,
					content: Buffer.from(file.content, 'utf8').toString('base64'),
					branch: params.branchName,
					...(existingSha ? { sha: existingSha } : {}),
				}),
			});
		}

		const pr = await this.request<{
			number: number;
			title: string;
			body: string | null;
			html_url: string;
			head: { ref: string };
		}>(`/repos/${this.repo}/pulls`, {
			method: 'POST',
			body: JSON.stringify({ title: params.title, body: params.body, head: params.branchName, base: baseBranch }),
		});

		return {
			number: pr.number,
			title: pr.title,
			body: pr.body,
			htmlUrl: pr.html_url,
			headRef: pr.head.ref,
			changedFiles: params.files.length,
			additions: 0,
			deletions: 0,
		};
	}
}

export const github = new GitHubClient();
