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
	 * Governance check for G2: the resume agent must not hold credentials that
	 * reach beyond the target repo. Fine-grained tokens expose their repo list at
	 * /installation/repositories; classic PATs do not, and are rejected outright
	 * because their scope cannot be proven.
	 */
	async assertScopedToTargetRepo(): Promise<{ repos: string[] }> {
		if (!this.repo) {
			throw new ScopeViolationError('ROCKETRIDE_TARGET_REPO is unset — refusing to run an unscoped agent.');
		}

		let body: { repositories?: Array<{ full_name: string }> };
		try {
			body = await this.request<{ repositories?: Array<{ full_name: string }> }>('/installation/repositories?per_page=100');
		} catch (error) {
			if (error instanceof GitHubError && (error.status === 403 || error.status === 404)) {
				throw new ScopeViolationError(
					'Token scope could not be verified (/installation/repositories unavailable). ' +
						'Use a fine-grained token scoped to the target repo; classic PATs are refused.'
				);
			}
			throw error;
		}

		const repos = (body.repositories ?? []).map((r) => r.full_name);
		const beyond = repos.filter((r) => r.toLowerCase() !== this.repo.toLowerCase());
		if (beyond.length > 0) {
			throw new ScopeViolationError(
				`Token reaches repos outside the target: ${beyond.join(', ')}. Re-scope it to ${this.repo} only.`
			);
		}
		return { repos };
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
}

export const github = new GitHubClient();
