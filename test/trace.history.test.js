// RTM regression pipeline: command runner, run history, state diff, and the full run→save→diff loop.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCommand, runCommands } from '../dist/core/trace/runner.js';
import { saveRun, listRuns, loadPreviousRun, diffStates, applyDiff } from '../dist/core/trace/history.js';
import { computeReport } from '../dist/core/trace/computeState.js';
import { parseTraceConfig } from '../dist/core/trace/config.js';
import { runTrace } from '../dist/core/trace/index.js';

/* ── runner ── */

test('runCommand captures exit code + output', () => {
  const root = mkdtempSync(join(tmpdir(), 'rtm-run-'));
  const ok = runCommand({ tech: 'node', command: 'node -e "process.stdout.write(\'hi\')"' }, root, () => 0);
  assert.equal(ok.ok, true);
  assert.equal(ok.exitCode, 0);
  assert.match(ok.output, /hi/);

  const bad = runCommand({ tech: 'node', command: 'node -e "process.exit(3)"' }, root, () => 0);
  assert.equal(bad.ok, false);
  assert.equal(bad.exitCode, 3);
});

test('runCommands skips specs without a command', () => {
  const root = mkdtempSync(join(tmpdir(), 'rtm-run2-'));
  const runs = runCommands(
    [{ tech: 'a' }, { tech: 'b', command: 'node -e "0"' }],
    root,
    () => 0,
  );
  assert.equal(runs.length, 1);
  assert.equal(runs[0].tech, 'b');
});

/* ── history store ── */

function reportWith(states) {
  // states: { KEY: 'verified'|'failing'|... } — build a report whose requirements have those states.
  const requirements = Object.keys(states).map((key) => ({
    key, title: key, declaredStatus: null, declaredComplete: false, source: 'markdown',
  }));
  const refs = [];
  const byKey = new Map();
  for (const [key, st] of Object.entries(states)) {
    refs.push({ key, file: 'f', title: 't', tech: 'jest', via: 'tag' });
    if (st === 'verified') byKey.set(key, { passed: 1, failed: 0, skipped: 0, lastRun: null });
    else if (st === 'failing') byKey.set(key, { passed: 0, failed: 1, skipped: 0, lastRun: null });
    else if (st === 'unverified') byKey.set(key, { passed: 0, failed: 0, skipped: 0, lastRun: null });
    // specified → no ref + no result
    if (st === 'specified') refs.pop();
  }
  return computeReport({
    requirements, refs, ingested: { byKey, occurrences: [] },
    git: { sha: 'a', shortSha: 'abc12345', branch: 'main', dirty: false, committedAt: null },
    generatedAt: '2026-06-19T00:00:00.000Z',
  });
}

test('saveRun + listRuns + loadPreviousRun round-trip', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rtm-hist-'));
  const r = reportWith({ 'PROJ-1': 'verified' });
  const path = saveRun(r, dir);
  assert.match(readFileSync(path, 'utf8'), /PROJ-1/);
  assert.equal(listRuns(dir).length, 1);
  const prev = loadPreviousRun(dir);
  assert.equal(prev.requirements[0].key, 'PROJ-1');
});

/* ── diff ── */

test('diffStates flags regressions and improvements by rank', () => {
  const prev = reportWith({ 'PROJ-1': 'verified', 'PROJ-2': 'specified', 'PROJ-3': 'verified' });
  const curr = reportWith({ 'PROJ-1': 'failing', 'PROJ-2': 'verified', 'PROJ-3': 'verified' });
  const { regressions, improvements } = diffStates(prev, curr);
  assert.equal(regressions.length, 1);
  assert.deepEqual([regressions[0].key, regressions[0].from, regressions[0].to], ['PROJ-1', 'verified', 'failing']);
  assert.equal(improvements.length, 1);
  assert.equal(improvements[0].key, 'PROJ-2');
});

test('applyDiff stamps regressions + comparedTo onto the report', () => {
  const prev = reportWith({ 'PROJ-1': 'verified' });
  const curr = reportWith({ 'PROJ-1': 'failing' });
  applyDiff(curr, prev, 'prev.json');
  assert.equal(curr.stats.regressions, 1);
  assert.equal(curr.regressions[0].to, 'failing');
  assert.equal(curr.comparedTo.ref, 'abc12345');
  assert.equal(curr.comparedTo.file, 'prev.json');
});

/* ── full loop: run suite → save → diff → regression ── */

test('runTrace with history: a result flip is reported as a regression', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rtm-loop-'));
  mkdirSync(join(root, 'e2e', 'results'), { recursive: true });
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs', 'requirements.md'), '- [ ] PROJ-1 Login');
  writeFileSync(join(root, 'e2e', 'login.spec.ts'), `test('login @PROJ-1', ...)`);
  const junit = join(root, 'e2e', 'results', 'junit.xml');
  const pass = `<testsuites><testsuite><testcase name="login @PROJ-1"></testcase></testsuite></testsuites>`;
  const failXml = `<testsuites><testsuite><testcase name="login @PROJ-1"><failure/></testcase></testsuite></testsuites>`;

  const config = parseTraceConfig(JSON.stringify({
    scopes: [{ requirements: [{ type: 'markdown', path: 'docs/requirements.md' }],
      tests: [{ tech: 'playwright', globs: ['e2e/**/*.spec.ts'], results: ['e2e/results/*.xml'] }] }],
    history: { dir: 'runs' },
  }));

  writeFileSync(junit, pass);
  const run1 = await runTrace(config, root);
  assert.equal(run1.requirements[0].state, 'verified');
  assert.equal(run1.stats.regressions, 0); // no prior run

  writeFileSync(junit, failXml);
  const run2 = await runTrace(config, root);
  assert.equal(run2.requirements[0].state, 'failing');
  assert.equal(run2.stats.regressions, 1);
  assert.deepEqual([run2.regressions[0].from, run2.regressions[0].to], ['verified', 'failing']);
  assert.ok(listRuns(join(root, 'runs')).length >= 2);
});

test('runTrace --run executes the suite command before ingesting', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rtm-cmd-'));
  mkdirSync(join(root, 'e2e'), { recursive: true });
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs', 'requirements.md'), '- [ ] PROJ-1 Login');
  writeFileSync(join(root, 'e2e', 'login.spec.ts'), `test('login @PROJ-1', ...)`);
  // gen.js writes a passing JUnit file when the "suite" runs.
  writeFileSync(
    join(root, 'gen.js'),
    `const fs=require('fs');fs.mkdirSync('e2e/results',{recursive:true});` +
      `fs.writeFileSync('e2e/results/out.xml','<testsuites><testsuite><testcase name="login @PROJ-1"></testcase></testsuite></testsuites>');`,
  );
  const config = parseTraceConfig(JSON.stringify({
    scopes: [{ requirements: [{ type: 'markdown', path: 'docs/requirements.md' }],
      tests: [{ tech: 'playwright', globs: ['e2e/**/*.spec.ts'], results: ['e2e/results/*.xml'], command: 'node gen.js' }] }],
  }));

  const report = await runTrace(config, root, { run: true });
  assert.equal(report.requirements[0].state, 'verified'); // only true if the command actually ran + produced results
});
