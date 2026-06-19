/**
 * Requirements from issue trackers — GitHub or GitLab issues (the common non-Jira source). Each issue
 * becomes a requirement keyed `<prefix><number>` (default `GH-`/`GL-`, so tests tag `@GH-123`); the
 * issue's open/closed state drives declaredComplete (→ drift detection). Filter by label/milestone.
 * Tokens come from the config or `GITHUB_TOKEN` / `GITLAB_TOKEN` (omit for public repos).
 */
import type { Requirement } from '../types.js';

export interface GithubIssuesSource {
  repo: string; // owner/name
  label?: string;
  milestone?: string;
  keyPrefix?: string;
  baseUrl?: string;
  token?: string;
}

export interface GitlabIssuesSource {
  project: string; // group/name or numeric id
  label?: string;
  keyPrefix?: string;
  baseUrl?: string;
  token?: string;
}

/** Map a GitHub issue → Requirement. Pure — unit-tested without a network. */
export function githubIssueToRequirement(
  issue: { number: number; title?: string; state?: string; html_url?: string },
  prefix = 'GH-',
  scope?: string,
): Requirement {
  return {
    key: `${prefix}${issue.number}`.toUpperCase(),
    title: issue.title ?? `Issue ${issue.number}`,
    declaredStatus: issue.state ?? null,
    declaredComplete: issue.state === 'closed',
    source: 'github-issues',
    url: issue.html_url,
    scope,
  };
}

/** Map a GitLab issue → Requirement. Pure. */
export function gitlabIssueToRequirement(
  issue: { iid: number; title?: string; state?: string; web_url?: string },
  prefix = 'GL-',
  scope?: string,
): Requirement {
  return {
    key: `${prefix}${issue.iid}`.toUpperCase(),
    title: issue.title ?? `Issue ${issue.iid}`,
    declaredStatus: issue.state ?? null,
    declaredComplete: issue.state === 'closed',
    source: 'gitlab-issues',
    url: issue.web_url,
    scope,
  };
}

/** Fetch GitHub issues (paged, PRs skipped) → requirements. */
export async function fetchGithubRequirements(src: GithubIssuesSource, scope?: string): Promise<Requirement[]> {
  const token = src.token ?? process.env.GITHUB_TOKEN;
  const base = (src.baseUrl ?? 'https://api.github.com').replace(/\/+$/, '');
  const prefix = src.keyPrefix ?? 'GH-';
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'acp-trace' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const out: Requirement[] = [];
  for (let page = 1; page <= 50; page += 1) {
    let path = `${base}/repos/${src.repo}/issues?state=all&per_page=100&page=${page}`;
    if (src.label) path += `&labels=${encodeURIComponent(src.label)}`;
    if (src.milestone) path += `&milestone=${encodeURIComponent(src.milestone)}`;
    const res = await fetch(path, { headers });
    if (!res.ok) throw new Error(`GitHub ${res.status} for ${src.repo} — set token if private/rate-limited`);
    const issues = (await res.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(issues) || issues.length === 0) break;
    for (const i of issues) {
      if (i.pull_request) continue; // the issues API also returns PRs
      out.push(githubIssueToRequirement(i as never, prefix, scope));
    }
    if (issues.length < 100) break;
  }
  return out;
}

/** Fetch GitLab issues (paged) → requirements. */
export async function fetchGitlabRequirements(src: GitlabIssuesSource, scope?: string): Promise<Requirement[]> {
  const token = src.token ?? process.env.GITLAB_TOKEN;
  const base = (src.baseUrl ?? 'https://gitlab.com').replace(/\/+$/, '');
  const prefix = src.keyPrefix ?? 'GL-';
  const headers: Record<string, string> = {};
  if (token) headers['PRIVATE-TOKEN'] = token;
  const project = encodeURIComponent(src.project);

  const out: Requirement[] = [];
  for (let page = 1; page <= 50; page += 1) {
    let path = `${base}/api/v4/projects/${project}/issues?state=all&per_page=100&page=${page}`;
    if (src.label) path += `&labels=${encodeURIComponent(src.label)}`;
    const res = await fetch(path, { headers });
    if (!res.ok) throw new Error(`GitLab ${res.status} for ${src.project} — set token if private`);
    const issues = (await res.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(issues) || issues.length === 0) break;
    for (const i of issues) out.push(gitlabIssueToRequirement(i as never, prefix, scope));
    if (issues.length < 100) break;
  }
  return out;
}
