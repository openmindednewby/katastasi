// Phase 3 v2: field-level auto-merge — disjoint-field edits merge; same-field divergence stays a conflict.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fieldMerge } from '../dist/core/sync/classify.js';
import { planSync } from '../dist/core/sync/plan.js';
import { executeSync } from '../dist/core/sync/execute.js';
import { FakeAdapter } from '../dist/core/sync/adapters/fake.js';
import { writeTask, readTask } from '../dist/core/trace/tasks/model.js';
import { listLocalRecords } from '../dist/core/sync/localTasks.js';
import { parseTraceConfig } from '../dist/core/trace/config.js';

const rec = (o = {}) => ({ title: 'Login', body: 'do it', status: 'todo', labels: ['auth'], ...o });

test('fieldMerge: disjoint changes merge; same-field divergence conflicts', () => {
  const base = rec();
  // local changed title, remote changed status → disjoint → merge both
  let m = fieldMerge(base, rec({ title: 'Login v2' }), rec({ status: 'done' }));
  assert.deepEqual(m.conflicts, []);
  assert.equal(m.merged.title, 'Login v2');
  assert.equal(m.merged.status, 'done');
  assert.equal(m.merged.body, 'do it'); // untouched → base

  // both changed title differently → conflict on title
  m = fieldMerge(base, rec({ title: 'L-local' }), rec({ title: 'L-remote' }));
  assert.deepEqual(m.conflicts, ['title']);

  // both changed title to the SAME value → no conflict
  m = fieldMerge(base, rec({ title: 'Same' }), rec({ title: 'Same' }));
  assert.deepEqual(m.conflicts, []);
  assert.equal(m.merged.title, 'Same');
});

test('planSync: field-merge turns a disjoint both-changed into a merge action', () => {
  const key = '.acp/tasks/TASK-1.md';
  const base = rec();
  const args = [
    [{ path: '/p/TASK-1.md', key, task: {}, record: rec({ title: 'L' }) }],
    [{ id: 'I1', rev: 'r2', fields: rec({ status: 'done' }) }],
    { [key]: { remoteId: 'I1', remoteRev: 'r1', base } },
  ];
  assert.equal(planSync(...args, 'conflict-flag').items[0].action, 'conflict'); // v1 default
  const merged = planSync(...args, 'field-merge').items[0];
  assert.equal(merged.action, 'merge');
  assert.equal(merged.merged.title, 'L');
  assert.equal(merged.merged.status, 'done');
});

test('executeSync: field-merge applies the merged record to both sides', async () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'sync-merge-'));
  const tasksRoot = join(baseDir, '.acp', 'tasks');
  const today = '2026-06-24';
  writeTask(tasksRoot, { id: 'TASK-1', title: 'Login v2', status: 'todo', requirements: [], tests: [], assignee: null, source: 'local', created: today, updated: today, body: 'do it', labels: ['auth'] });
  const adapter = new FakeAdapter([{ id: 'I1', rev: 'r1', fields: rec({ status: 'done' }) }]); // remote changed status
  const state = { '.acp/tasks/TASK-1.md': { remoteId: 'I1', remoteRev: 'r1', base: rec() } }; // base = unchanged

  const locals = listLocalRecords(baseDir, tasksRoot);
  const plan = planSync(locals, await adapter.list(), state, 'field-merge');
  assert.equal(plan.items[0].action, 'merge');
  const res = await executeSync(plan, adapter, state, { baseDir, bindingId: 'b', tasksRoot, idPrefix: 'TASK', today, apply: true, direction: 'both' });
  assert.equal(res.summary.merge, 1);
  assert.equal(res.conflicts.length, 0);
  // both sides now have title 'Login v2' (local) AND status 'done' (remote)
  assert.equal((await adapter.get('I1')).fields.title, 'Login v2');
  assert.equal((await adapter.get('I1')).fields.status, 'done');
  assert.equal(readTask(join(tasksRoot, 'TASK-1.md')).status, 'done');
});

test('config: sync.mergeStrategy parses', () => {
  const cfg = parseTraceConfig(JSON.stringify({
    scopes: [{ requirements: [{ type: 'markdown', path: 'r.md' }] }],
    sync: { mergeStrategy: 'field-merge', bindings: [{ id: 'g', remote: { type: 'github', repo: 'o/r' } }] },
  }));
  assert.equal(cfg.sync.mergeStrategy, 'field-merge');
});
