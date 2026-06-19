// Notifications: trigger levels + message building (pure; no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldNotify, buildNotification } from '../dist/core/trace/notify.js';
import { computeReport } from '../dist/core/trace/computeState.js';
import { applyDiff } from '../dist/core/trace/history.js';

function report(states, prevStates) {
  const mk = (st) => {
    const requirements = Object.keys(st).map((key) => ({ key, title: key, declaredStatus: null, declaredComplete: false, source: 'markdown' }));
    const refs = [];
    const byKey = new Map();
    for (const [key, s] of Object.entries(st)) {
      if (s !== 'specified') refs.push({ key, file: 'f', title: 't', tech: 'jest', via: 'tag' });
      if (s === 'verified') byKey.set(key, { passed: 1, failed: 0, skipped: 0, lastRun: null });
      else if (s === 'failing') byKey.set(key, { passed: 0, failed: 1, skipped: 0, lastRun: null });
    }
    return computeReport({
      requirements, refs, ingested: { byKey, occurrences: [] },
      git: { sha: null, shortSha: 'abc1234', branch: 'main', dirty: false, committedAt: null },
      generatedAt: '2026-06-19T00:00:00Z', project: 'Demo',
    });
  };
  const curr = mk(states);
  if (prevStates) applyDiff(curr, mk(prevStates));
  return curr;
}

test('shouldNotify: trigger levels', () => {
  const clean = report({ 'PROJ-1': 'verified' });
  const failing = report({ 'PROJ-1': 'failing' });
  const regressed = report({ 'PROJ-1': 'failing' }, { 'PROJ-1': 'verified' });

  assert.equal(shouldNotify(clean, 'regression'), false);
  assert.equal(shouldNotify(regressed, 'regression'), true);
  assert.equal(shouldNotify(failing, 'failing'), true);
  assert.equal(shouldNotify(clean, 'failing'), false);
  assert.equal(shouldNotify(clean, 'always'), true);
});

test('buildNotification: text + payload reflect the report', () => {
  const regressed = report({ 'PROJ-1': 'failing' }, { 'PROJ-1': 'verified' });
  const { text, payload } = buildNotification(regressed);
  assert.match(text, /RTM Demo @ abc1234 \(main\): ⛔ 1 regression/);
  assert.match(text, /PROJ-1 verified→failing/);
  assert.equal(payload.commit, 'abc1234');
  assert.equal(payload.stats.regressions, 1);
  assert.equal(payload.text, text); // Slack/Teams render `text`
});
