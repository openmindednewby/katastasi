// Phase 1 step 9: read-only Jira import — maps issues → source:jira tasks, idempotent + prune.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importJiraTasks } from '../dist/core/trace/tasks/importJira.js';
import { addTask, TaskError } from '../dist/core/trace/tasks/ops.js';
import { listTasks } from '../dist/core/trace/tasks/model.js';
import { parseTraceConfig } from '../dist/core/trace/config.js';

const NOW = '2026-06-22';
const jiraConfig = () => parseTraceConfig(JSON.stringify({
  scopes: [{ name: 'core', requirements: [{ type: 'markdown', path: 'r.md' }], tests: [] }],
  tasks: { mode: 'jira', jira: { epic: 'PROJ-1' } },
}));
const localConfig = () => parseTraceConfig(JSON.stringify({
  scopes: [{ name: 'core', requirements: [{ type: 'markdown', path: 'r.md' }], tests: [] }],
}));

const req = (key, title, status) => ({ key, title, declaredStatus: status, declaredComplete: status === 'Done', source: 'jira-epic', url: `https://jira/${key}` });

test('imports issues as source:jira tasks (key=id, jira status preserved)', async () => {
  const base = mkdtempSync(join(tmpdir(), 'rtm-imp-'));
  const fetch = async () => [req('PROJ-2', 'Login', 'In Progress'), req('PROJ-3', 'Logout', 'Done')];
  const r = await importJiraTasks(base, jiraConfig(), { now: NOW, fetch });
  assert.deepEqual(r.imported, ['PROJ-2', 'PROJ-3']);
  const tasks = listTasks(join(base, '.acp', 'tasks'));
  const p2 = tasks.find((t) => t.id === 'PROJ-2');
  assert.equal(p2.source, 'jira');
  assert.equal(p2.status, 'In Progress'); // raw jira status
  assert.match(p2.body, /Imported from Jira: https:\/\/jira\/PROJ-2/);
  assert.ok(existsSync(join(base, '.acp', 'tasks', 'PROJ-2.md')));
});

test('re-import is idempotent + prunes stale jira tasks, leaves local tasks alone', async () => {
  const base = mkdtempSync(join(tmpdir(), 'rtm-imp2-'));
  const cfg = jiraConfig();
  // a local task must survive imports (added via a local-mode config so the write isn't blocked)
  addTask(base, localConfig(), { title: 'mine' }, NOW); // → TASK-1 (source local)

  await importJiraTasks(base, cfg, { now: NOW, fetch: async () => [req('PROJ-2', 'A', 'To Do'), req('PROJ-3', 'B', 'To Do')] });
  // second import: PROJ-3 gone from the epic → should be pruned
  const r2 = await importJiraTasks(base, cfg, { now: NOW, fetch: async () => [req('PROJ-2', 'A renamed', 'Done')] });
  assert.deepEqual(r2.imported, ['PROJ-2']);
  assert.deepEqual(r2.pruned, ['PROJ-3']);

  const ids = listTasks(join(base, '.acp', 'tasks')).map((t) => t.id).sort();
  assert.deepEqual(ids, ['PROJ-2', 'TASK-1']); // PROJ-3 pruned, local TASK-1 intact
  assert.equal(listTasks(join(base, '.acp', 'tasks')).find((t) => t.id === 'PROJ-2').title, 'A renamed'); // overwritten
});

test('import requires mode:jira and an epic', async () => {
  const base = mkdtempSync(join(tmpdir(), 'rtm-imp3-'));
  await assert.rejects(() => importJiraTasks(base, localConfig(), { fetch: async () => [] }), TaskError);
  const noEpic = parseTraceConfig(JSON.stringify({ scopes: [{ requirements: [{ type: 'markdown', path: 'r.md' }], tests: [] }], tasks: { mode: 'jira' } }));
  await assert.rejects(() => importJiraTasks(base, noEpic, { fetch: async () => [] }), /jira\.epic is required/);
});
