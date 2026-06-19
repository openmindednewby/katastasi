// Agent helpers: scaffold a key-tagged test stub + look up a requirement's status.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { globToStubPath, skeleton, scaffoldTest } from '../dist/core/trace/scaffoldTest.js';
import { requirementStatus } from '../dist/core/trace/index.js';
import { parseTraceConfig } from '../dist/core/trace/config.js';

test('globToStubPath: dir before wildcard + name + suffix', () => {
  assert.equal(globToStubPath('e2e/**/*.spec.ts', 'proj-1'), 'e2e/proj-1.spec.ts');
  assert.equal(globToStubPath('src/**/*.test.ts', 'proj-1'), 'src/proj-1.test.ts');
  assert.equal(globToStubPath('Services/**/*Tests.cs', 'Proj1'), 'Services/Proj1Tests.cs');
});

test('skeleton: each tech tags the key', () => {
  assert.match(skeleton('playwright', 'PROJ-1', 'Login'), /@PROJ-1.*async \(\{ page \}\)/s);
  assert.match(skeleton('jest', 'PROJ-1', 'Login'), /test\('Login @PROJ-1'/);
  assert.match(skeleton('node', 'PROJ-1', 'Login'), /node:test/);
  assert.match(skeleton('xunit', 'PROJ-1', 'Login'), /\[Trait\("req", "PROJ-1"\)\]/);
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'rtm-scaf-'));
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs', 'requirements.md'), '- [ ] PROJ-1 Login');
  writeFileSync(
    join(root, 'acp-trace.json'),
    JSON.stringify({ scopes: [{ requirements: [{ type: 'markdown', path: 'docs/requirements.md' }], tests: [{ tech: 'playwright', globs: ['e2e/**/*.spec.ts'] }] }] }),
  );
  return root;
}

test('scaffoldTest: writes a tagged stub once, then keeps it (no clobber)', () => {
  const root = fixture();
  const cfg = parseTraceConfig(readFileSync(join(root, 'acp-trace.json'), 'utf8'));
  const first = scaffoldTest(cfg, root, { key: 'PROJ-1', title: 'Login' });
  assert.equal(first.created, true);
  assert.equal(first.path, 'e2e/proj-1.spec.ts');
  assert.match(readFileSync(join(root, first.path), 'utf8'), /@PROJ-1/);
  const again = scaffoldTest(cfg, root, { key: 'PROJ-1' });
  assert.equal(again.created, false); // not clobbered
});

test('scaffoldTest: --tech selects the group; unknown tech throws', () => {
  const root = mkdtempSync(join(tmpdir(), 'rtm-scaf2-'));
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs', 'requirements.md'), '- [ ] PROJ-1 X');
  const cfg = parseTraceConfig(JSON.stringify({
    scopes: [{ requirements: [{ type: 'markdown', path: 'docs/requirements.md' }],
      tests: [{ tech: 'playwright', globs: ['e2e/**/*.spec.ts'] }, { tech: 'xunit', globs: ['Svc/**/*Tests.cs'] }] }],
  }));
  const cs = scaffoldTest(cfg, root, { key: 'PROJ-1', tech: 'xunit' });
  assert.equal(cs.path, 'Svc/Proj1Tests.cs');
  assert.ok(existsSync(join(root, cs.path)));
  assert.throws(() => scaffoldTest(cfg, root, { key: 'PROJ-1', tech: 'cypress' }), /no test group/);
});

test('requirementStatus: scaffolded requirement is unverified, missing key is null', async () => {
  const root = fixture();
  const cfg = parseTraceConfig(readFileSync(join(root, 'acp-trace.json'), 'utf8'));
  scaffoldTest(cfg, root, { key: 'PROJ-1' }); // now a test references PROJ-1
  const r = await requirementStatus(cfg, root, 'PROJ-1');
  assert.equal(r.state, 'unverified'); // referenced, not run
  assert.equal(r.tests.length, 1);
  assert.equal(await requirementStatus(cfg, root, 'PROJ-999'), null);
});
