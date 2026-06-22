/**
 * Task operations — the behaviour layer over the task model: add / list / show / set-status / link.
 * Enforces the configured status set, scope-aware id allocation, date stamping, and the read-only
 * guard for non-`local` modes (jira/hybrid). The CLI (step 7) and MCP (step 8) are thin wrappers.
 */
import { dirname, join } from 'node:path';
import type { ResolvedTasksConfig, TraceConfig, TraceScope } from '../config.js';
import { resolveTasksConfig, scopeTaskPrefix } from '../config.js';
import { tasksDir } from '../store.js';
import { allocateId, findTaskPath, listTasks, readTask, writeTask, type Task } from './model.js';

export class TaskError extends Error {}

/** Today's date (YYYY-MM-DD). Overridable in ops for deterministic tests. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const dedupe = (a: string[]): string[] => [...new Set(a.filter((x) => x.length > 0))];

function ensureWritable(resolved: ResolvedTasksConfig): void {
  if (resolved.mode !== 'local') {
    throw new TaskError(
      `tasks.mode is "${resolved.mode}" — tasks are read-only here. Two-way write lands in Phase 3; ` +
        `use mode: local to manage tasks (jira mode imports issues read-only via \`katastasi task import\`).`,
    );
  }
}

function assertStatus(resolved: ResolvedTasksConfig, status: string): void {
  if (!resolved.statuses.includes(status)) {
    throw new TaskError(`Unknown status "${status}". Allowed: ${resolved.statuses.join(', ')}`);
  }
}

function scopeByName(config: TraceConfig, name: string): TraceScope {
  const scope = config.scopes.find((s) => s.name === name);
  if (!scope) {
    throw new TaskError(`Unknown scope "${name}". Scopes: ${config.scopes.map((s) => s.name ?? '(unnamed)').join(', ')}`);
  }
  return scope;
}

/** Locate an existing task's file + parsed content; throws if absent. */
function locate(baseDir: string, resolved: ResolvedTasksConfig, id: string): { task: Task; dir: string } {
  const path = findTaskPath(tasksDir(baseDir, resolved.dir), id);
  if (!path) throw new TaskError(`Task not found: ${id}`);
  return { task: readTask(path), dir: dirname(path) };
}

export interface AddTaskInput {
  title: string;
  requirements?: string[];
  tests?: string[];
  status?: string;
  assignee?: string | null;
  scope?: string; // scope NAME (uses that scope's taskPrefix + subfolder if it sets one)
  body?: string;
}

export function addTask(baseDir: string, config: TraceConfig, input: AddTaskInput, now: string = today()): Task {
  const resolved = resolveTasksConfig(config);
  ensureWritable(resolved);
  if (!input.title.trim()) throw new TaskError('A task needs a title.');
  const status = input.status ?? resolved.statuses[0];
  assertStatus(resolved, status);

  const scope = input.scope ? scopeByName(config, input.scope) : undefined;
  const prefix = scopeTaskPrefix(resolved, scope);
  const root = tasksDir(baseDir, resolved.dir);
  // A scope gets its own subfolder only when it declares its own prefix.
  const dir = scope?.taskPrefix ? join(root, scope.name ?? prefix) : root;

  const task: Task = {
    id: allocateId(baseDir, prefix),
    title: input.title.trim(),
    status,
    requirements: dedupe(input.requirements ?? []),
    tests: dedupe(input.tests ?? []),
    assignee: input.assignee ?? null,
    source: 'local',
    created: now,
    updated: now,
    body: input.body ?? '',
  };
  writeTask(dir, task);
  return task;
}

export interface ListFilter {
  status?: string;
  req?: string;
}

export function listTasksFiltered(baseDir: string, config: TraceConfig, filter: ListFilter = {}): Task[] {
  const resolved = resolveTasksConfig(config);
  let tasks = listTasks(tasksDir(baseDir, resolved.dir));
  if (filter.status) tasks = tasks.filter((t) => t.status === filter.status);
  if (filter.req) tasks = tasks.filter((t) => t.requirements.includes(filter.req as string));
  return tasks.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

export function getTask(baseDir: string, config: TraceConfig, id: string): Task | null {
  const resolved = resolveTasksConfig(config);
  const path = findTaskPath(tasksDir(baseDir, resolved.dir), id);
  return path ? readTask(path) : null;
}

export function setTaskStatus(baseDir: string, config: TraceConfig, id: string, status: string, now: string = today()): Task {
  const resolved = resolveTasksConfig(config);
  ensureWritable(resolved);
  assertStatus(resolved, status);
  const { task, dir } = locate(baseDir, resolved, id);
  task.status = status;
  task.updated = now;
  writeTask(dir, task);
  return task;
}

export interface LinkInput {
  requirements?: string[];
  tests?: string[];
}

export function linkTask(baseDir: string, config: TraceConfig, id: string, input: LinkInput, now: string = today()): Task {
  const resolved = resolveTasksConfig(config);
  ensureWritable(resolved);
  const { task, dir } = locate(baseDir, resolved, id);
  task.requirements = dedupe([...task.requirements, ...(input.requirements ?? [])]);
  task.tests = dedupe([...task.tests, ...(input.tests ?? [])]);
  task.updated = now;
  writeTask(dir, task);
  return task;
}
