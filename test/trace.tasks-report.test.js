// Phase 1 step 7: reportForTasks — latest saved run vs fresh --run, null when none.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reportForTasks } from '../dist/core/trace/tasks/report.js';
import { parseTraceConfig } from '../dist/core/trace/config.js';

function repoWithReqs() {
  const base = mkdtempSync(join(tmpdir(), 'rtm-rep-'));
  writeFileSync(join(base, 'reqs.md'), '- [ ] PROJ-1 Login\n- [ ] PROJ-2 Logout');
  const config = parseTraceConfig(JSON.stringify({
    scopes: [{ requirements: [{ type: 'markdown', path: 'reqs.md' }], tests: [] }],
    history: {},
  }));
  return { base, config };
}

test('no saved run → null report', async () => {
  const { base, config } = repoWithReqs();
  const src = await reportForTasks(base, config, {});
  assert.equal(src.report, null);
  assert.equal(src.fresh, false);
});

test('latest saved run is returned (non-git dir → not stale)', async () => {
  const { base, config } = repoWithReqs();
  mkdirSync(join(base, '.acp', 'runs'), { recursive: true });
  writeFileSync(
    join(base, '.acp', 'runs', '2026-06-22T00-00-00-000Z_nogit.json'),
    JSON.stringify({ generatedAt: '2026-06-22T00:00:00Z', git: { sha: null, shortSha: null }, requirements: [{ key: 'PROJ-1', state: 'verified' }] }),
  );
  const src = await reportForTasks(base, config, {});
  assert.ok(src.report);
  assert.equal(src.fresh, false);
  assert.equal(src.stale, false);
  assert.equal(src.report.requirements[0].key, 'PROJ-1');
});

test('--run produces a fresh report from the config', async () => {
  const { base, config } = repoWithReqs();
  const src = await reportForTasks(base, config, { run: true });
  assert.ok(src.report);
  assert.equal(src.fresh, true);
  assert.deepEqual(src.report.requirements.map((r) => r.key).sort(), ['PROJ-1', 'PROJ-2']);
});
