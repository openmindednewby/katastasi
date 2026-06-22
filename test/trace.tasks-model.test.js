// Phase 1 step 3: task model — markdown round-trip, file IO, manifest id allocation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  serializeTask, parseTask, writeTask, readTask, listTasks, findTaskPath,
  allocateId, readTaskCounters, taskFileName,
} from '../dist/core/trace/tasks/model.js';

const sample = {
  id: 'TASK-1',
  title: 'Implement login',
  status: 'in-progress',
  requirements: ['PROJ-1', 'PROJ-2'],
  tests: ['e2e/login.spec.ts@PROJ-1'],
  assignee: 'demetris',
  source: 'local',
  created: '2026-06-22',
  updated: '2026-06-22',
  body: 'Notes here.',
};

test('serialize → parse round-trips all fields', () => {
  const t = parseTask(serializeTask(sample));
  assert.deepEqual(t, sample);
});

test('parse: null assignee (~), empty arrays, missing body', () => {
  const md = serializeTask({ ...sample, assignee: null, requirements: [], tests: [], body: '' });
  const t = parseTask(md);
  assert.equal(t.assignee, null);
  assert.deepEqual(t.requirements, []);
  assert.equal(t.body, '');
});

test('special chars in title survive (colon/quotes via JSON quoting)', () => {
  const tricky = { ...sample, title: 'Fix: the "weird" bug [edge]' };
  const t = parseTask(serializeTask(tricky));
  assert.equal(t.title, 'Fix: the "weird" bug [edge]');
});

test('source coerces to local unless jira', () => {
  assert.equal(parseTask(serializeTask({ ...sample, source: 'jira' })).source, 'jira');
  assert.equal(parseTask(serializeTask({ ...sample, source: 'nonsense' })).source, 'local');
});

test('writeTask / readTask / listTasks across scope subfolders', () => {
  const root = mkdtempSync(join(tmpdir(), 'rtm-tm-'));
  writeTask(root, sample);                                   // .acp/tasks root
  writeTask(join(root, 'web'), { ...sample, id: 'WEB-1' });  // per-scope subfolder
  assert.equal(readTask(join(root, taskFileName('TASK-1'))).id, 'TASK-1');
  const all = listTasks(root).map((t) => t.id).sort();
  assert.deepEqual(all, ['TASK-1', 'WEB-1']);               // recurses into web/
  assert.equal(findTaskPath(root, 'WEB-1'), join(root, 'web', 'WEB-1.md'));
  assert.equal(findTaskPath(root, 'NOPE'), null);
  assert.equal(listTasks(join(root, 'does-not-exist')).length, 0);
});

test('allocateId increments per prefix, persists, preserves other manifest keys', () => {
  const base = mkdtempSync(join(tmpdir(), 'rtm-mf-'));
  assert.equal(allocateId(base, 'TASK'), 'TASK-1');
  assert.equal(allocateId(base, 'TASK'), 'TASK-2');
  assert.equal(allocateId(base, 'WEB'), 'WEB-1');           // independent counter
  assert.deepEqual(readTaskCounters(base), { TASK: 2, WEB: 1 });
  // a future Phase-3 sync key must survive an allocation
  const mfPath = join(base, '.acp', 'manifest.json');
  const m = JSON.parse(readFileSync(mfPath, 'utf8'));
  m.sync = { hello: 'world' };
  writeFileSync(mfPath, JSON.stringify(m));
  allocateId(base, 'TASK');
  assert.deepEqual(JSON.parse(readFileSync(mfPath, 'utf8')).sync, { hello: 'world' });
});
