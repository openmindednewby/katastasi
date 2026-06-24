// Phase 3 step 7: runSync orchestrator (config + injected fake adapter) + config block + sync status.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSync, syncLinks } from '../dist/core/sync/sync.js';
import { FakeAdapter } from '../dist/core/sync/adapters/fake.js';
import { parseTraceConfig } from '../dist/core/trace/config.js';
import { writeTask, readTask } from '../dist/core/trace/tasks/model.js';

const today = '2026-06-24';
const task = (id, o = {}) => ({ id, title: id, status: 'todo', requirements: [], tests: [], assignee: null, source: 'local', created: today, updated: today, body: 'b', ...o });

function repo(tasks) {
  const dir = mkdtempSync(join(tmpdir(), 'sync-orch-'));
  for (const t of tasks) writeTask(join(dir, '.acp', 'tasks'), t);
  return dir;
}

const ghConfig = parseTraceConfig(JSON.stringify({
  scopes: [{ requirements: [{ type: 'markdown', path: 'r.md' }] }],
  sync: { bindings: [{ id: 'tasks-gh', statusMap: { todo: 'open', done: 'closed' }, remote: { type: 'github', repo: 'o/r' } }] },
}));

test('config: sync block parses (github + jira bindings)', () => {
  const cfg = parseTraceConfig(JSON.stringify({
    scopes: [{ requirements: [{ type: 'markdown', path: 'r.md' }] }],
    sync: { bindings: [
      { id: 'gh', remote: { type: 'github', repo: 'o/r', labelFilter: 'sync' } },
      { id: 'jira', statusMap: { done: 'Done' }, remote: { type: 'jira', jql: 'project = P', projectKey: 'P' } },
    ] },
  }));
  assert.equal(cfg.sync.bindings.length, 2);
  assert.equal(cfg.sync.bindings[0].remote.repo, 'o/r');
  assert.equal(cfg.sync.bindings[1].remote.type, 'jira');
});

test('runSync preview: reports would-create, writes nothing', async () => {
  const dir = repo([task('TASK-1', { title: 'Login', status: 'done' })]);
  const adapter = new FakeAdapter();
  const res = await runSync(ghConfig, dir, { apply: false, adapters: { 'tasks-gh': adapter }, today });
  assert.equal(res[0].summary['create-remote'], 1);
  assert.equal((await adapter.list()).length, 0); // nothing written
  assert.deepEqual(syncLinks(ghConfig, dir)[0].links, []); // no state saved
});

test('runSync apply: creates issue, status mapped done→closed, links + state persisted', async () => {
  const dir = repo([task('TASK-1', { title: 'Login', status: 'done' })]);
  const adapter = new FakeAdapter();
  const res = await runSync(ghConfig, dir, { apply: true, adapters: { 'tasks-gh': adapter }, today });
  assert.equal(res[0].summary['create-remote'], 1);
  const issue = (await adapter.list())[0];
  assert.equal(issue.fields.status, 'closed'); // done → closed via statusMap
  // state persisted → re-run is a no-op
  const links = syncLinks(ghConfig, dir)[0].links;
  assert.equal(links.length, 1);
  const res2 = await runSync(ghConfig, dir, { apply: true, adapters: { 'tasks-gh': adapter }, today });
  assert.equal(res2[0].summary.skip, 1);
});

test('runSync apply: pulling a closed issue creates a local task with status done', async () => {
  const dir = repo([]);
  const adapter = new FakeAdapter([{ id: 'ISSUE-1', rev: 'r1', fields: { title: 'From issue', body: 'x', status: 'closed', labels: [] } }]);
  const res = await runSync(ghConfig, dir, { apply: true, adapters: { 'tasks-gh': adapter }, today });
  assert.equal(res[0].summary['pull-create'], 1);
  const key = syncLinks(ghConfig, dir)[0].links[0].key; // repo-relative forward-slash path
  const created = readTask(join(dir, key));
  assert.equal(created.title, 'From issue');
  assert.equal(created.status, 'done'); // closed → done via statusMap reverse
  assert.equal(created.remoteId, 'ISSUE-1');
});

test('runSync: missing GITHUB_TOKEN → per-binding error, not a throw', async () => {
  const dir = repo([task('TASK-1')]);
  const res = await runSync(ghConfig, dir, { apply: false, env: {}, today }); // no injected adapter, no token
  assert.match(res[0].error, /GITHUB_TOKEN/);
});

test('runSync: unknown binding filter throws', async () => {
  await assert.rejects(() => runSync(ghConfig, repo([]), { binding: 'nope' }), /no sync binding/);
});
