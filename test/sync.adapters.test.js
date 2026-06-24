// Phase 3 step 6: status mapper + GitHub & Jira adapters (fake fetch) + status round-trip via engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeStatusMapper, identityMapper } from '../dist/core/sync/statusMapper.js';
import { GithubAdapter, issueToRecord, recordToIssuePayload } from '../dist/core/sync/adapters/github.js';
import { JiraAdapter, jiraIssueToRecord, recordToJiraFields } from '../dist/core/sync/adapters/jira.js';
import { RevisionConflict } from '../dist/core/sync/model.js';
import { listLocalRecords } from '../dist/core/sync/localTasks.js';
import { writeTask, readTask } from '../dist/core/trace/tasks/model.js';

// ── status mapper ─────────────────────────────────────────────────────────────────────────

test('makeStatusMapper: local↔remote with first-mapped reverse', () => {
  const m = makeStatusMapper({ todo: 'open', 'in-progress': 'open', done: 'closed' });
  assert.equal(m.toRemote('done'), 'closed');
  assert.equal(m.toRemote('in-progress'), 'open');
  assert.equal(m.toRemote('weird'), 'open'); // fallback
  assert.equal(m.toLocal('closed'), 'done');
  assert.equal(m.toLocal('open'), 'todo'); // first local mapped to open
  assert.equal(identityMapper.toRemote('x'), 'x');
});

test('local task status maps to remote vocab via mapper', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-map-'));
  const root = join(dir, '.acp', 'tasks');
  writeTask(root, { id: 'TASK-1', title: 'A', status: 'done', requirements: [], tests: [], assignee: null, source: 'local', created: '2026-06-24', updated: '2026-06-24', body: 'b' });
  const m = makeStatusMapper({ todo: 'open', done: 'closed' });
  assert.equal(listLocalRecords(dir, root, m)[0].record.status, 'closed'); // done → closed
});

// ── GitHub adapter (fake fetch) ───────────────────────────────────────────────────────────

const ghIssue = { number: 5, title: 'Login', body: 'do it', state: 'open', updated_at: '2026-06-24T10:00:00Z', html_url: 'https://github.com/o/r/issues/5', labels: [{ name: 'auth' }] };

test('github: issueToRecord + recordToIssuePayload', () => {
  const r = issueToRecord(ghIssue);
  assert.deepEqual(r, { id: '5', rev: '2026-06-24T10:00:00Z', url: 'https://github.com/o/r/issues/5', fields: { title: 'Login', body: 'do it', status: 'open', labels: ['auth'] } });
  assert.deepEqual(recordToIssuePayload({ title: 'X', body: 'y', status: 'closed', labels: [] }), { title: 'X', body: 'y', labels: [], state: 'closed' });
});

function fakeFetch(routes) {
  return async (url, init) => {
    const method = init?.method ?? 'GET';
    const key = `${method} ${url.replace(/^https?:\/\/[^/]+/, '')}`;
    const match = routes.find((r) => key.startsWith(r.when));
    if (!match) return { ok: false, status: 404, async text() { return `no route ${key}`; } };
    return { ok: true, status: 200, async json() { return typeof match.body === 'function' ? match.body(init) : match.body; }, async text() { return ''; } };
  };
}

test('github: list excludes PRs + create posts the payload', async () => {
  const created = [];
  const adapter = new GithubAdapter({ repo: 'o/r', token: 't', fetchImpl: fakeFetch([
    { when: 'GET /repos/o/r/issues?', body: [ghIssue, { number: 6, title: 'PR', state: 'open', updated_at: 'x', pull_request: {} }] },
    { when: 'POST /repos/o/r/issues', body: (init) => { created.push(JSON.parse(init.body)); return { ...ghIssue, number: 7 }; } },
  ]) });
  const list = await adapter.list();
  assert.equal(list.length, 1); // PR filtered out
  const rec = await adapter.create({ title: 'New', body: 'b', status: 'open', labels: ['x'] });
  assert.equal(rec.id, '7');
  assert.deepEqual(created[0], { title: 'New', body: 'b', labels: ['x'], state: 'open' });
});

test('github: update re-checks revision → RevisionConflict if it moved', async () => {
  const adapter = new GithubAdapter({ repo: 'o/r', token: 't', fetchImpl: fakeFetch([
    { when: 'GET /repos/o/r/issues/5', body: { ...ghIssue, updated_at: 'MOVED' } },
  ]) });
  await assert.rejects(() => adapter.update('5', { title: 'X', body: '', status: 'open', labels: [] }, '2026-06-24T10:00:00Z'), RevisionConflict);
});

// ── Jira adapter (pure mappers + fake fetch) ──────────────────────────────────────────────

test('jira: issueToRecord (ADF→md) + recordToJiraFields (md→ADF)', () => {
  const issue = { key: 'PROJ-1', fields: { summary: 'Login', description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] }, status: { name: 'To Do' }, labels: ['auth'], updated: '2026-06-24T10:00:00Z' } };
  const r = jiraIssueToRecord(issue, 'https://x.atlassian.net');
  assert.equal(r.id, 'PROJ-1');
  assert.equal(r.fields.status, 'To Do');
  assert.match(r.fields.body, /hello/);
  assert.equal(r.url, 'https://x.atlassian.net/browse/PROJ-1');
  const fields = recordToJiraFields({ title: 'T', body: 'body', status: 'Done', labels: ['a'] }, { projectKey: 'PROJ', issueType: 'Task' });
  assert.equal(fields.summary, 'T');
  assert.equal(fields.project.key, 'PROJ');
  assert.equal(fields.description.type, 'doc'); // ADF
});

test('jira: list maps search results', async () => {
  const adapter = new JiraAdapter({ baseUrl: 'https://x.atlassian.net', email: 'e', apiToken: 't', jql: 'project = PROJ', fetchImpl: fakeFetch([
    { when: 'POST /rest/api/3/search', body: { issues: [{ key: 'PROJ-1', fields: { summary: 'A', status: { name: 'Done' }, labels: [], updated: 'u1' } }] } },
  ]) });
  const list = await adapter.list();
  assert.equal(list[0].id, 'PROJ-1');
  assert.equal(list[0].fields.status, 'Done');
});
