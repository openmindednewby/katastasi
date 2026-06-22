// Phase 1 step 5: honesty cross-check — verifyTasks + driftRule (unverified/strict/failing).
import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyTasks, computeDrift, summarizeDrift } from '../dist/core/trace/tasks/verify.js';

const task = (over = {}) => ({ id: 'TASK-1', title: 't', status: 'done', requirements: [], tests: [], assignee: null, source: 'local', created: '', updated: '', body: '', ...over });
const report = (pairs) => ({ requirements: pairs.map(([key, state]) => ({ key, state })) });
const resolved = (over = {}) => ({ mode: 'local', dir: '.acp/tasks', idPrefix: 'TASK', statuses: ['todo', 'in-progress', 'blocked', 'done'], doneStatuses: ['done'], verifyDone: true, driftRule: 'unverified', ...over });

const driftOf = (t, rep, res) => verifyTasks([t], rep, res)[0].drift;

test('unverified rule: done + verified req = ok; any not-verified = drift; no reqs = ok', () => {
  const rep = report([['PROJ-1', 'verified'], ['PROJ-2', 'failing'], ['PROJ-3', 'specified']]);
  assert.equal(driftOf(task({ requirements: ['PROJ-1'] }), rep, resolved()), false);
  assert.equal(driftOf(task({ requirements: ['PROJ-2'] }), rep, resolved()), true); // failing
  assert.equal(driftOf(task({ requirements: ['PROJ-3'] }), rep, resolved()), true); // specified (no test)
  assert.equal(driftOf(task({ requirements: ['PROJ-1', 'PROJ-3'] }), rep, resolved()), true); // any
  assert.equal(driftOf(task({ requirements: [] }), rep, resolved()), false); // no reqs → not drift
});

test('non-done task never drifts, even with unverified reqs', () => {
  const rep = report([['PROJ-1', 'specified']]);
  assert.equal(driftOf(task({ status: 'in-progress', requirements: ['PROJ-1'] }), rep, resolved()), false);
});

test('unknown req (not in report) counts as not-verified under unverified, not under failing', () => {
  const rep = report([['PROJ-1', 'verified']]);
  assert.equal(driftOf(task({ requirements: ['GHOST-9'] }), rep, resolved({ driftRule: 'unverified' })), true);
  assert.equal(driftOf(task({ requirements: ['GHOST-9'] }), rep, resolved({ driftRule: 'failing' })), false);
});

test('strict rule: also flags done-with-no-requirements', () => {
  const rep = report([['PROJ-1', 'verified']]);
  assert.equal(driftOf(task({ requirements: [] }), rep, resolved({ driftRule: 'strict' })), true);
  assert.equal(driftOf(task({ requirements: ['PROJ-1'] }), rep, resolved({ driftRule: 'strict' })), false);
});

test('failing rule: only an actively-failing req drifts', () => {
  const rep = report([['PROJ-1', 'specified'], ['PROJ-2', 'failing']]);
  assert.equal(driftOf(task({ requirements: ['PROJ-1'] }), rep, resolved({ driftRule: 'failing' })), false); // specified ok
  assert.equal(driftOf(task({ requirements: ['PROJ-2'] }), rep, resolved({ driftRule: 'failing' })), true);
});

test('verifyDone off → never drift; reason + states still reported', () => {
  const rep = report([['PROJ-1', 'failing']]);
  const v = verifyTasks([task({ requirements: ['PROJ-1'] })], rep, resolved({ verifyDone: false }))[0];
  assert.equal(v.drift, false);
  assert.equal(v.reason, null);
  assert.deepEqual(v.requirements, [{ key: 'PROJ-1', state: 'failing' }]);
});

test('reason text + summarizeDrift counts', () => {
  const rep = report([['PROJ-1', 'verified'], ['PROJ-2', 'failing']]);
  const vs = verifyTasks(
    [task({ id: 'TASK-1', requirements: ['PROJ-1'] }), task({ id: 'TASK-2', requirements: ['PROJ-2'] }), task({ id: 'TASK-3', status: 'todo', requirements: ['PROJ-2'] })],
    rep,
    resolved(),
  );
  const sum = summarizeDrift(vs);
  assert.equal(sum.total, 3);
  assert.equal(sum.done, 2); // TASK-1, TASK-2 done; TASK-3 todo
  assert.equal(sum.drift, 1); // only TASK-2
  assert.equal(sum.drifted[0].task.id, 'TASK-2');
  assert.match(sum.drifted[0].reason, /not verified: PROJ-2 \(failing\)/);
});

test('computeDrift unit: case-insensitive key match handled by verifyTasks', () => {
  // computeDrift itself works on resolved states
  assert.equal(computeDrift([{ key: 'X', state: 'verified' }], 'unverified'), false);
  assert.equal(computeDrift([], 'strict'), true);
  assert.equal(computeDrift([{ key: 'X', state: 'unknown' }], 'failing'), false);
  // verifyTasks matches keys case-insensitively
  const rep = report([['proj-1', 'verified']]);
  assert.equal(verifyTasks([task({ requirements: ['PROJ-1'] })], rep, resolved())[0].drift, false);
});
