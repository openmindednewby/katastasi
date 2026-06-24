/**
 * Jira `SyncAdapter`. `SyncRecord.status` carries the Jira status NAME (e.g. "To Do" / "Done"); the
 * local mapper translates to/from the task vocabulary. Body round-trips as markdown ⇄ ADF via the
 * existing converters. Auth is Basic (email:token); the revision token is the issue's `fields.updated`.
 * Status changes go through Jira transitions (best-effort — skipped with no error if none matches).
 * `fetchImpl` is injectable so the request/response mapping is tested with a fake fetch — no network.
 */
import { adfToMarkdown, type AdfNode } from '../../adfToMarkdown.js';
import { markdownToAdf } from '../../markdownToAdf.js';
import { RevisionConflict, type RemoteRecord, type SyncAdapter, type SyncRecord } from '../model.js';

export interface JiraOptions {
  baseUrl: string;
  email: string;
  apiToken: string;
  jql: string; // scopes which issues sync (e.g. `project = PROJ`)
  projectKey?: string; // required to create
  issueType?: string; // default Task
  fetchImpl?: typeof fetch;
}

interface JiraIssue {
  key: string;
  fields: {
    summary?: string;
    description?: AdfNode;
    status?: { name?: string };
    labels?: string[];
    updated?: string;
  };
}

const ISSUE_FIELDS = 'summary,description,status,labels,updated';

/** Map a Jira issue → canonical record (status = the Jira status name; body = markdown). */
export function jiraIssueToRecord(issue: JiraIssue, baseUrl: string): RemoteRecord {
  const f = issue.fields ?? {};
  return {
    id: issue.key,
    rev: f.updated ?? '',
    url: `${baseUrl.replace(/\/$/, '')}/browse/${issue.key}`,
    fields: { title: f.summary ?? '', body: f.description ? adfToMarkdown(f.description) : '', status: f.status?.name ?? '', labels: f.labels ?? [] },
  };
}

/** Build the `fields` object for create/update (status is handled separately via transitions). */
export function recordToJiraFields(fields: SyncRecord, create?: { projectKey: string; issueType: string }): Record<string, unknown> {
  return {
    summary: fields.title,
    description: markdownToAdf(fields.body),
    labels: fields.labels,
    ...(create ? { project: { key: create.projectKey }, issuetype: { name: create.issueType } } : {}),
  };
}

export class JiraAdapter implements SyncAdapter {
  private readonly doFetch: typeof fetch;
  constructor(private opts: JiraOptions) {
    this.doFetch = opts.fetchImpl ?? fetch;
  }

  private headers(): Record<string, string> {
    const token = Buffer.from(`${this.opts.email}:${this.opts.apiToken}`).toString('base64');
    return { Authorization: `Basic ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' };
  }

  private async req(path: string, init?: RequestInit): Promise<Response> {
    const res = await this.doFetch(`${this.opts.baseUrl.replace(/\/$/, '')}${path}`, { ...init, headers: { ...this.headers(), ...(init?.headers ?? {}) } });
    if (!res.ok) throw new Error(`jira ${init?.method ?? 'GET'} ${path} → ${res.status} ${await res.text()}`);
    return res;
  }

  async list(): Promise<RemoteRecord[]> {
    const res = await this.req('/rest/api/3/search', { method: 'POST', body: JSON.stringify({ jql: this.opts.jql, fields: ISSUE_FIELDS.split(','), maxResults: 100 }) });
    const data = (await res.json()) as { issues?: JiraIssue[] };
    return (data.issues ?? []).map((i) => jiraIssueToRecord(i, this.opts.baseUrl));
  }

  async read(id: string): Promise<RemoteRecord> {
    const res = await this.req(`/rest/api/3/issue/${id}?fields=${ISSUE_FIELDS}`);
    return jiraIssueToRecord((await res.json()) as JiraIssue, this.opts.baseUrl);
  }

  async create(fields: SyncRecord): Promise<RemoteRecord> {
    if (!this.opts.projectKey) throw new Error('jira: projectKey is required to create issues');
    const res = await this.req('/rest/api/3/issue', {
      method: 'POST',
      body: JSON.stringify({ fields: recordToJiraFields(fields, { projectKey: this.opts.projectKey, issueType: this.opts.issueType ?? 'Task' }) }),
    });
    const created = (await res.json()) as { key: string };
    const rec = await this.read(created.key);
    if (fields.status) await this.transition(created.key, fields.status).catch(() => undefined);
    return rec;
  }

  async update(id: string, fields: SyncRecord, expectedRev: string): Promise<RemoteRecord> {
    const current = await this.read(id); // optimistic concurrency
    if (current.rev !== expectedRev) throw new RevisionConflict(id, expectedRev, current.rev);
    await this.req(`/rest/api/3/issue/${id}`, { method: 'PUT', body: JSON.stringify({ fields: recordToJiraFields(fields) }) });
    if (fields.status && fields.status !== current.fields.status) await this.transition(id, fields.status).catch(() => undefined);
    return this.read(id);
  }

  /** Best-effort status change via a workflow transition whose target name matches `statusName`. */
  private async transition(id: string, statusName: string): Promise<void> {
    const res = await this.req(`/rest/api/3/issue/${id}/transitions`);
    const data = (await res.json()) as { transitions?: Array<{ id: string; to?: { name?: string } }> };
    const match = (data.transitions ?? []).find((t) => t.to?.name?.toLowerCase() === statusName.toLowerCase());
    if (match) await this.req(`/rest/api/3/issue/${id}/transitions`, { method: 'POST', body: JSON.stringify({ transition: { id: match.id } }) });
  }
}
