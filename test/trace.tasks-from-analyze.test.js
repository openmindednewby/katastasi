// Phase 1 step 10: analyze → native tasks bridge (createTasksFromAnalyze + analyze hook).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTasksFromAnalyze } from '../dist/core/trace/tasks/fromAnalyze.js';
import { listTasks } from '../dist/core/trace/tasks/model.js';
import { parseTraceConfig } from '../dist/core/trace/config.js';
import { analyze } from '../dist/core/analyze/analyze.js';

const localCfg = () => parseTraceConfig(JSON.stringify({ scopes: [{ requirements: [{ type: 'markdown', path: 'r.md' }], tests: [] }] }));

test('createTasksFromAnalyze: creates linked tasks, deduped on re-run', () => {
  const base = mkdtempSync(join(tmpdir(), 'rtm-fa-'));
  const items = [{ key: 'PROJ-1', title: 'Login' }, { key: 'PROJ-2', title: 'Logout' }];
  const ids1 = createTasksFromAnalyze(base, localCfg(), items);
  assert.deepEqual(ids1, ['TASK-1', 'TASK-2']);
  const t1 = listTasks(join(base, '.acp', 'tasks')).find((t) => t.id === 'TASK-1');
  assert.deepEqual(t1.requirements, ['PROJ-1']);
  // re-run with same items → no duplicates
  assert.deepEqual(createTasksFromAnalyze(base, localCfg(), items), []);
  assert.equal(listTasks(join(base, '.acp', 'tasks')).length, 2);
});

test('createTasksFromAnalyze: jira mode creates nothing', () => {
  const base = mkdtempSync(join(tmpdir(), 'rtm-fa2-'));
  const jira = parseTraceConfig(JSON.stringify({ scopes: [{ requirements: [{ type: 'markdown', path: 'r.md' }], tests: [] }], tasks: { mode: 'jira', jira: { epic: 'PROJ-1' } } }));
  assert.deepEqual(createTasksFromAnalyze(base, jira, [{ key: 'PROJ-1', title: 'X' }]), []);
});

const FAKE = JSON.stringify({
  gapAnalysis: 'g',
  technicalAnalysis: '# T',
  tasks: [{ key: 'PROJ-1', title: 'Login', acceptanceCriteria: ['ok'], tests: [] }],
});

test('analyze hook: full run creates native board tasks (and --no-tasks skips)', async () => {
  const base = mkdtempSync(join(tmpdir(), 'rtm-fa3-'));
  mkdirSync(join(base, 'docs'), { recursive: true });
  writeFileSync(join(base, 'docs', 'requirements.md'), '- [ ] PROJ-1 Login');
  const config = parseTraceConfig(JSON.stringify({ scopes: [{ requirements: [{ type: 'markdown', path: 'docs/requirements.md' }], tests: [] }] }));

  const r = await analyze(config, base, { chat: async () => FAKE, outDir: 'ta', scaffold: false });
  assert.deepEqual(r.nativeTasks, ['TASK-1']);
  assert.ok(existsSync(join(base, '.acp', 'tasks', 'TASK-1.md')));
  const t = listTasks(join(base, '.acp', 'tasks'))[0];
  assert.deepEqual(t.requirements, ['PROJ-1']);
  assert.equal(t.title, 'Login');

  // writeTasks:false skips native task creation
  const base2 = mkdtempSync(join(tmpdir(), 'rtm-fa4-'));
  mkdirSync(join(base2, 'docs'), { recursive: true });
  writeFileSync(join(base2, 'docs', 'requirements.md'), '- [ ] PROJ-1 Login');
  const r2 = await analyze(config, base2, { chat: async () => FAKE, outDir: 'ta', scaffold: false, writeTasks: false });
  assert.deepEqual(r2.nativeTasks, []);
  assert.equal(existsSync(join(base2, '.acp', 'tasks')), false);
});
