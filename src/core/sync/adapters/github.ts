/**
 * GitHub Issues `SyncAdapter`. `SyncRecord.status` carries the GitHub vocabulary ('open' / 'closed');
 * the status mapper at the local boundary translates to/from the task vocabulary. Auth is a token
 * (GITHUB_TOKEN) over the REST API; the revision token is the issue's `updated_at`. `fetchImpl` is
 * injectable so the request/response mapping is tested with a fake fetch — no network.
 */
import { RevisionConflict, type RemoteRecord, type SyncAdapter, type SyncRecord } from '../model.js';

export interface GithubOptions {
  repo: string; // owner/name
  token: string;
  labelFilter?: string; // only issues with this label are in scope
  baseUrl?: string; // default https://api.github.com
  fetchImpl?: typeof fetch;
}

interface GithubIssue {
  number: number;
  title: string;
  body: string | null;
  state: string; // open | closed
  updated_at: string;
  html_url?: string;
  labels?: Array<{ name: string } | string>;
  pull_request?: unknown; // PRs come through /issues too — excluded
}

/** Map a GitHub issue → canonical record (status = the GitHub state). */
export function issueToRecord(issue: GithubIssue): RemoteRecord {
  const labels = (issue.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));
  return {
    id: String(issue.number),
    rev: issue.updated_at,
    url: issue.html_url,
    fields: { title: issue.title, body: issue.body ?? '', status: issue.state, labels },
  };
}

/** Build the JSON body for create/update from a record. */
export function recordToIssuePayload(fields: SyncRecord): Record<string, unknown> {
  return { title: fields.title, body: fields.body, labels: fields.labels, state: fields.status === 'closed' ? 'closed' : 'open' };
}

export class GithubAdapter implements SyncAdapter {
  private readonly api: string;
  private readonly doFetch: typeof fetch;

  constructor(private opts: GithubOptions) {
    this.api = `${opts.baseUrl ?? 'https://api.github.com'}/repos/${opts.repo}`;
    this.doFetch = opts.fetchImpl ?? fetch;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.opts.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  private async json(path: string, init?: RequestInit): Promise<unknown> {
    const res = await this.doFetch(`${this.api}${path}`, { ...init, headers: { ...this.headers(), ...(init?.headers ?? {}) } });
    if (!res.ok) throw new Error(`github ${init?.method ?? 'GET'} ${path} → ${res.status} ${await res.text()}`);
    return res.json();
  }

  async list(): Promise<RemoteRecord[]> {
    const q = new URLSearchParams({ state: 'all', per_page: '100', ...(this.opts.labelFilter ? { labels: this.opts.labelFilter } : {}) });
    const issues = (await this.json(`/issues?${q}`)) as GithubIssue[];
    return issues.filter((i) => !i.pull_request).map(issueToRecord);
  }

  async read(id: string): Promise<RemoteRecord> {
    return issueToRecord((await this.json(`/issues/${id}`)) as GithubIssue);
  }

  async create(fields: SyncRecord): Promise<RemoteRecord> {
    return issueToRecord((await this.json('/issues', { method: 'POST', body: JSON.stringify(recordToIssuePayload(fields)) })) as GithubIssue);
  }

  async update(id: string, fields: SyncRecord, expectedRev: string): Promise<RemoteRecord> {
    const current = await this.read(id); // optimistic concurrency: re-check updated_at
    if (current.rev !== expectedRev) throw new RevisionConflict(id, expectedRev, current.rev);
    return issueToRecord((await this.json(`/issues/${id}`, { method: 'PATCH', body: JSON.stringify(recordToIssuePayload(fields)) })) as GithubIssue);
  }
}
