// RTM engine (offline): glob, test scanner, result ingest, state join, reports, section updater.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { globToRegExp, globFiles } from '../dist/core/trace/glob.js';
import { extractRefs, parseMapping, mappingToRefs, scanTestSources, techForFile } from '../dist/core/trace/testScanner.js';
import { parseJUnit, parseTrx, ingestResults } from '../dist/core/trace/results.js';
import { deriveState, computeReport } from '../dist/core/trace/computeState.js';
import { renderMarkdown } from '../dist/core/trace/report/markdown.js';
import { renderHtml } from '../dist/core/trace/report/html.js';
import { updateSection, hasSection } from '../dist/core/trace/sectionUpdater.js';

/* ── glob ── */

test('globToRegExp: ** spans dirs, * stays within a segment', () => {
  const re = globToRegExp('src/**/*.test.ts');
  assert.ok(re.test('src/a/b/x.test.ts'));
  assert.ok(re.test('src/x.test.ts'));
  assert.ok(!re.test('src/x.spec.ts'));
});

test('globToRegExp: {a,b} alternation', () => {
  const re = globToRegExp('t/**/*.{spec,test}.ts');
  assert.ok(re.test('t/x.spec.ts'));
  assert.ok(re.test('t/d/y.test.ts'));
  assert.ok(!re.test('t/y.e2e.ts'));
});

test('globFiles finds matches and skips node_modules', () => {
  const root = mkdtempSync(join(tmpdir(), 'rtm-glob-'));
  mkdirSync(join(root, 'tests'));
  mkdirSync(join(root, 'node_modules'));
  writeFileSync(join(root, 'tests', 'a.spec.ts'), 'x');
  writeFileSync(join(root, 'node_modules', 'b.spec.ts'), 'x');
  const found = globFiles(root, ['tests/**/*.spec.ts', 'node_modules/**/*.spec.ts']);
  assert.deepEqual(found, ['tests/a.spec.ts']);
});

/* ── scanner ── */

test('extractRefs: title tag, @req comment, and xUnit Trait', () => {
  const pw = `test('user can log in @PROJ-12', async () => {});`;
  assert.deepEqual(extractRefs(pw, 'a.spec.ts', 'playwright').map((r) => r.key), ['PROJ-12']);

  const comment = `// @req PROJ-34 covered below\nit('does thing', ...)`;
  const refs = extractRefs(comment, 'b.test.ts', 'jest');
  assert.equal(refs[0].key, 'PROJ-34');
  assert.equal(refs[0].line, 1);

  const cs = `[Trait("req", "PROJ-56")]\npublic void Works(){}`;
  const t = extractRefs(cs, 'C.cs', 'xunit');
  assert.equal(t[0].key, 'PROJ-56');
  assert.equal(t[0].via, 'trait');
});

test('extractRefs: a line tagging two keys yields two refs, deduped per key', () => {
  const refs = extractRefs(`test('multi @PROJ-1 @PROJ-2 @PROJ-1', ...)`, 'a.spec.ts', 'playwright');
  assert.deepEqual(refs.map((r) => r.key).sort(), ['PROJ-1', 'PROJ-2']);
});

test('parseMapping: JSON and minimal YAML both work, keys uppercased', () => {
  const json = parseMapping('{"proj-1":["a.ts","b.ts"],"PROJ-2":"c.cs"}', 'm.json');
  assert.deepEqual(json['PROJ-1'], ['a.ts', 'b.ts']);
  assert.deepEqual(json['PROJ-2'], ['c.cs']);

  const yaml = parseMapping('PROJ-1:\n  - a.ts\n  - b.ts\nPROJ-2: c.cs\n', 'm.yml');
  assert.deepEqual(yaml['PROJ-1'], ['a.ts', 'b.ts']);
  assert.deepEqual(yaml['PROJ-2'], ['c.cs']);
});

test('mappingToRefs + techForFile', () => {
  const refs = mappingToRefs({ 'PROJ-1': ['x.spec.ts', 'y.cs'] });
  assert.equal(refs.length, 2);
  assert.equal(refs[0].via, 'mapping');
  assert.equal(techForFile('x.spec.ts'), 'playwright');
  assert.equal(techForFile('y.cs'), 'xunit');
  assert.equal(techForFile('z.test.tsx'), 'jest');
});

test('scanTestSources walks globs and extracts keys', () => {
  const root = mkdtempSync(join(tmpdir(), 'rtm-scan-'));
  mkdirSync(join(root, 'e2e'));
  writeFileSync(join(root, 'e2e', 'login.spec.ts'), `test('login @PROJ-9', ...)`);
  const refs = scanTestSources(root, [{ tech: 'playwright', globs: ['e2e/**/*.spec.ts'] }]);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].key, 'PROJ-9');
  assert.equal(refs[0].file, 'e2e/login.spec.ts');
});

/* ── results ── */

test('parseJUnit: pass / fail / skip detection', () => {
  const xml = `<testsuites><testsuite>
    <testcase name="a @PROJ-1" classname="x"></testcase>
    <testcase name="b @PROJ-2"><failure message="boom"/></testcase>
    <testcase name="c @PROJ-3"><skipped/></testcase>
    <testcase name="d @PROJ-4" />
  </testsuite></testsuites>`;
  const out = parseJUnit(xml);
  assert.equal(out.find((t) => t.name.includes('PROJ-1')).status, 'passed');
  assert.equal(out.find((t) => t.name.includes('PROJ-2')).status, 'failed');
  assert.equal(out.find((t) => t.name.includes('PROJ-3')).status, 'skipped');
  assert.equal(out.find((t) => t.name.includes('PROJ-4')).status, 'passed');
});

test('parseTrx: outcome mapping', () => {
  const xml = `<TestRun><Results>
    <UnitTestResult testName="N.PROJ-1.Works" outcome="Passed" />
    <UnitTestResult testName="N.PROJ-2.Breaks" outcome="Failed" />
    <UnitTestResult testName="N.PROJ-3.Skip" outcome="NotExecuted" />
  </Results></TestRun>`;
  const out = parseTrx(xml);
  assert.equal(out.find((t) => t.name.includes('PROJ-1')).status, 'passed');
  assert.equal(out.find((t) => t.name.includes('PROJ-2')).status, 'failed');
  assert.equal(out.find((t) => t.name.includes('PROJ-3')).status, 'skipped');
});

test('ingestResults aggregates per key across files', () => {
  const root = mkdtempSync(join(tmpdir(), 'rtm-res-'));
  const f = join(root, 'junit.xml');
  writeFileSync(
    f,
    `<testsuites><testsuite>
      <testcase name="x @PROJ-1"></testcase>
      <testcase name="y @PROJ-1"><failure/></testcase>
    </testsuite></testsuites>`,
  );
  const { byKey } = ingestResults([f]);
  const r = byKey.get('PROJ-1');
  assert.equal(r.passed, 1);
  assert.equal(r.failed, 1);
  assert.ok(r.lastRun);
});

/* ── state join ── */

test('deriveState covers all four states', () => {
  const ref = [{ key: 'X', file: 'f', title: 't', tech: 'jest', via: 'tag' }];
  assert.equal(deriveState(ref, { passed: 1, failed: 0, skipped: 0, lastRun: null }), 'verified');
  assert.equal(deriveState(ref, { passed: 1, failed: 1, skipped: 0, lastRun: null }), 'failing');
  assert.equal(deriveState(ref, { passed: 0, failed: 0, skipped: 0, lastRun: null }), 'unverified');
  assert.equal(deriveState([], { passed: 0, failed: 0, skipped: 0, lastRun: null }), 'specified');
});

function fixtureReport() {
  const requirements = [
    { key: 'PROJ-1', title: 'Login', declaredStatus: 'Done', declaredComplete: true, source: 'jira-epic' },
    { key: 'PROJ-2', title: 'Logout', declaredStatus: 'Done', declaredComplete: true, source: 'jira-epic' },
    { key: 'PROJ-3', title: 'Reset', declaredStatus: 'To Do', declaredComplete: false, source: 'jira-epic' },
  ];
  const refs = [
    { key: 'PROJ-1', file: 'login.spec.ts', title: 'login', tech: 'playwright', via: 'tag' },
    { key: 'PROJ-2', file: 'logout.spec.ts', title: 'logout', tech: 'playwright', via: 'tag' },
    { key: 'PROJ-999', file: 'ghost.spec.ts', title: 'ghost', tech: 'playwright', via: 'tag' },
  ];
  const ingested = {
    byKey: new Map([
      ['PROJ-1', { passed: 2, failed: 0, skipped: 0, lastRun: '2026-06-19T00:00:00.000Z' }],
      ['PROJ-2', { passed: 0, failed: 1, skipped: 0, lastRun: '2026-06-19T00:00:00.000Z' }],
    ]),
    occurrences: [{ key: 'PROJ-999', file: 'ghost.spec.ts', status: 'passed' }],
  };
  const git = { sha: 'abc', shortSha: 'abc12345', branch: 'master', dirty: false, committedAt: null };
  return computeReport({ requirements, refs, ingested, git, generatedAt: '2026-06-19T12:00:00Z', project: 'Demo' });
}

test('computeReport: states, drift, orphans, stats', () => {
  const r = fixtureReport();
  const byKey = Object.fromEntries(r.requirements.map((x) => [x.key, x]));
  assert.equal(byKey['PROJ-1'].state, 'verified');
  assert.equal(byKey['PROJ-2'].state, 'failing');
  assert.equal(byKey['PROJ-3'].state, 'specified');
  assert.equal(byKey['PROJ-2'].drift, true); // declared Done but failing
  assert.equal(byKey['PROJ-1'].drift, false);
  assert.equal(r.orphanTests.length, 1);
  assert.equal(r.orphanTests[0].key, 'PROJ-999');
  assert.equal(r.stats.verified, 1);
  assert.equal(r.stats.coveragePct, 33);
});

/* ── reports ── */

test('renderMarkdown: header, matrix, drift + orphan sections', () => {
  const md = renderMarkdown(fixtureReport());
  assert.match(md, /# Requirements Traceability — Demo/);
  assert.match(md, /\*\*Commit:\*\* `abc12345` \(master\)/);
  assert.match(md, /\| \[PROJ-1\]|PROJ-1/);
  assert.match(md, /## ⚠️ Drift/);
  assert.match(md, /## 👻 Orphan tests/);
  assert.match(md, /\*\*Verified coverage\*\* \| \*\*33%\*\*/);
});

test('renderHtml: self-contained doc with data + filter script', () => {
  const html = renderHtml(fixtureReport());
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /id="rtm-data"/);
  assert.match(html, /data-state="verified"/);
  assert.match(html, /data-drift="true"/);
  assert.match(html, /details class="tests"/); // per-requirement drill-down
  assert.ok(!html.includes('</script><script>') === false); // has both scripts
});

/* ── section updater ── */

test('updateSection: appends then replaces idempotently', () => {
  const doc = '# Roadmap\n\nsome text\n';
  const once = updateSection(doc, 'rtm', 'BODY-A');
  assert.ok(hasSection(once, 'rtm'));
  assert.match(once, /# Roadmap/);
  assert.match(once, /BODY-A/);
  const twice = updateSection(once, 'rtm', 'BODY-B');
  assert.match(twice, /BODY-B/);
  assert.ok(!twice.includes('BODY-A'));
  // only one marker pair
  assert.equal((twice.match(/acp:trace:start rtm/g) || []).length, 1);
});
