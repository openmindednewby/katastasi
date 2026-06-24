// Phase 3 step 2-3: local task provider + reconcile planner (fake adapter, no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listLocalRecords, taskToRecord, applyRecord, writeRecordToTask, createTaskFromRecord } from '../dist/core/sync/localTasks.js';
import { planSync, planSummary } from '../dist/core/sync/plan.js';
import { writeTask } from '../dist/core/trace/tasks/model.js';

const today = '2026-06-24';
const task = (id, o = {}) => ({ id, title: id, status: 'todo', requirements: [], tests: [], assignee: null, source: 'local', created: today, updated: today, body: 'b', ...o });

function repoWith(tasks) {
  const dir = mkdtempSync(join(tmpdir(), 'sync-plan-'));
  const root = join(dir, '.acp', 'tasks');
  for (const t of tasks) writeTask(root, t);
  return { dir, root };
}

// ── local provider ────────────────────────────────────────────────────────────────────────

test('taskToRecord + applyRecord round-trip', () => {
  const t = task('TASK-1', { labels: ['auth'] });
  const r = taskToRecord(t);
  assert.deepEqual(r, { title: 'TASK-1', body: 'b', status: 'todo', labels: ['auth'] });
  const updated = applyRecord(t, { title: 'New', body: 'x', status: 'done', labels: [] }, '2026-06-25');
  assert.equal(updated.title, 'New');
  assert.equal(updated.status, 'done');
  assert.equal(updated.updated, '2026-06-25');
  assert.equal(updated.labels, undefined); // empty labels dropped
});

test('listLocalRecords: paths + records', () => {
  const { dir, root } = repoWith([task('TASK-1'), task('TASK-2', { status: 'done' })]);
  const recs = listLocalRecords(dir, root);
  assert.equal(recs.length, 2);
  assert.match(recs[0].key, /^\.acp\/tasks\/TASK-\d\.md$/);
});

test('writeRecordToTask + createTaskFromRecord', () => {
  const { dir, root } = repoWith([task('TASK-1')]);
  const path = join(root, 'TASK-1.md');
  writeRecordToTask(path, { title: 'Pulled', body: 'remote body', status: 'in-progress', labels: ['api'] }, '2026-06-25');
  assert.match(readFileSync(path, 'utf8'), /title: Pulled[\s\S]*status: in-progress[\s\S]*labels: \[api\]/);

  const created = createTaskFromRecord(dir, root, { title: 'From issue', body: 'rb', status: 'todo', labels: [] }, 'TASK', '2026-06-25');
  assert.match(created.task.id, /^TASK-\d+$/);
  assert.equal(created.task.title, 'From issue');
});

// ── planner ───────────────────────────────────────────────────────────────────────────────

const rec = (o = {}) => ({ title: 'Login', body: 'do it', status: 'todo', labels: ['auth'], ...o });
const remote = (id, o = {}) => ({ id, rev: 'r1', fields: rec(o) });

test('plan: unlinked local → create-remote; unlinked remote → pull-create', () => {
  const locals = [{ path: '/p/TASK-1.md', key: '.acp/tasks/TASK-1.md', task: {}, record: rec() }];
  const remotes = [remote('ISSUE-9', { title: 'Other' })];
  const plan = planSync(locals, remotes, {});
  const s = planSummary(plan);
  assert.equal(s['create-remote'], 1);
  assert.equal(s['pull-create'], 1);
});

test('plan: linked record classifies push / pull / conflict', () => {
  const key = '.acp/tasks/TASK-1.md';
  const base = rec();
  const mk = (local, remoteFields) => planSync(
    [{ path: '/p/TASK-1.md', key, task: {}, record: local }],
    [{ id: 'ISSUE-1', rev: 'r2', fields: remoteFields }],
    { [key]: { remoteId: 'ISSUE-1', remoteRev: 'r1', base } },
  ).items[0].action;

  assert.equal(mk(rec({ title: 'L2' }), rec()), 'push'); // local changed only
  assert.equal(mk(rec(), rec({ title: 'R2' })), 'pull'); // remote changed only
  assert.equal(mk(rec(), rec()), 'skip'); // neither
  assert.equal(mk(rec({ status: 'done' }), rec({ status: 'done' })), 'converged'); // same change
  const conflict = planSync(
    [{ path: '/p/TASK-1.md', key, task: {}, record: rec({ title: 'L' }) }],
    [{ id: 'ISSUE-1', rev: 'r2', fields: rec({ title: 'R' }) }],
    { [key]: { remoteId: 'ISSUE-1', remoteRev: 'r1', base } },
  ).items[0];
  assert.equal(conflict.action, 'conflict');
  assert.deepEqual(conflict.conflictFields, ['title']);
});

test('plan: vanished local → local-deleted; vanished remote → remote-deleted', () => {
  const key = '.acp/tasks/TASK-1.md';
  const st = { [key]: { remoteId: 'ISSUE-1', remoteRev: 'r1', base: rec() } };
  // local gone, remote present
  assert.equal(planSync([], [remote('ISSUE-1')], st).items[0].action, 'local-deleted');
  // local present, remote gone
  assert.equal(
    planSync([{ path: '/p/TASK-1.md', key, task: {}, record: rec() }], [], st).items[0].action,
    'remote-deleted',
  );
});
