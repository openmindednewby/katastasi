// Phase 1 step 4: task ops — add/list/show/set/link, validation, scope ids, jira read-only guard.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseTraceConfig } from '../dist/core/trace/config.js';
import { addTask, listTasksFiltered, getTask, setTaskStatus, linkTask, TaskError } from '../dist/core/trace/tasks/ops.js';

const NOW = '2026-06-22';
const localConfig = () => parseTraceConfig(JSON.stringify({
  scopes: [
    { name: 'core', requirements: [{ type: 'markdown', path: 'r.md' }], tests: [] },
    { name: 'web', taskPrefix: 'WEB', requirements: [{ type: 'markdown', path: 'r.md' }], tests: [] },
  ],
}));

test('addTask: allocates id, defaults status, stamps dates, writes file', () => {
  const base = mkdtempSync(join(tmpdir(), 'rtm-ops-'));
  const t = addTask(base, localConfig(), { title: 'Login', requirements: ['PROJ-1', 'PROJ-1'] }, NOW);
  assert.equal(t.id, 'TASK-1');
  assert.equal(t.status, 'todo'); // first configured status
  assert.deepEqual(t.requirements, ['PROJ-1']); // deduped
  assert.equal(t.created, NOW);
  assert.ok(existsSync(join(base, '.acp', 'tasks', 'TASK-1.md')));
});

test('addTask: per-scope prefix → WEB-1 in .acp/tasks/web/', () => {
  const base = mkdtempSync(join(tmpdir(), 'rtm-ops2-'));
  const t = addTask(base, localConfig(), { title: 'Nav', scope: 'web' }, NOW);
  assert.equal(t.id, 'WEB-1');
  assert.ok(existsSync(join(base, '.acp', 'tasks', 'web', 'WEB-1.md')));
});

test('addTask: unknown status / unknown scope throw', () => {
  const base = mkdtempSync(join(tmpdir(), 'rtm-ops3-'));
  assert.throws(() => addTask(base, localConfig(), { title: 'x', status: 'nope' }, NOW), /Unknown status/);
  assert.throws(() => addTask(base, localConfig(), { title: 'x', scope: 'ghost' }, NOW), /Unknown scope/);
});

test('list filters by status + req; show finds/misses', () => {
  const base = mkdtempSync(join(tmpdir(), 'rtm-ops4-'));
  const c = localConfig();
  addTask(base, c, { title: 'A', requirements: ['PROJ-1'] }, NOW);
  addTask(base, c, { title: 'B', requirements: ['PROJ-2'], status: 'done' }, NOW);
  assert.deepEqual(listTasksFiltered(base, c).map((t) => t.id), ['TASK-1', 'TASK-2']);
  assert.deepEqual(listTasksFiltered(base, c, { status: 'done' }).map((t) => t.id), ['TASK-2']);
  assert.deepEqual(listTasksFiltered(base, c, { req: 'PROJ-1' }).map((t) => t.id), ['TASK-1']);
  assert.equal(getTask(base, c, 'TASK-2').title, 'B');
  assert.equal(getTask(base, c, 'NOPE'), null);
});

test('setTaskStatus + linkTask mutate and re-stamp; not-found + bad status throw', () => {
  const base = mkdtempSync(join(tmpdir(), 'rtm-ops5-'));
  const c = localConfig();
  addTask(base, c, { title: 'A' }, '2026-06-01');
  const moved = setTaskStatus(base, c, 'TASK-1', 'in-progress', NOW);
  assert.equal(moved.status, 'in-progress');
  assert.equal(moved.updated, NOW);
  assert.equal(moved.created, '2026-06-01'); // created preserved
  const linked = linkTask(base, c, 'TASK-1', { requirements: ['PROJ-9'], tests: ['e2e/a@PROJ-9'] }, NOW);
  assert.deepEqual(linked.requirements, ['PROJ-9']);
  assert.deepEqual(linked.tests, ['e2e/a@PROJ-9']);
  assert.throws(() => setTaskStatus(base, c, 'TASK-1', 'nope', NOW), /Unknown status/);
  assert.throws(() => setTaskStatus(base, c, 'GHOST-1', 'done', NOW), /not found/);
});

test('jira mode: add/set/link are read-only (blocked)', () => {
  const base = mkdtempSync(join(tmpdir(), 'rtm-ops6-'));
  const jira = parseTraceConfig(JSON.stringify({
    scopes: [{ name: 'core', requirements: [{ type: 'markdown', path: 'r.md' }], tests: [] }],
    tasks: { mode: 'jira', jira: { epic: 'PROJ-1' } },
  }));
  assert.throws(() => addTask(base, jira, { title: 'x' }, NOW), TaskError);
  assert.throws(() => addTask(base, jira, { title: 'x' }, NOW), /read-only/);
});
