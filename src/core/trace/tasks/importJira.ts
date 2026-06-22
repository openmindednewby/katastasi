/**
 * Read-only Jira import (mode: jira). Pulls issues under `tasks.jira.epic` into `.acp/tasks/*.md`
 * marked `source: jira` — the Jira key is the task id, the Jira status is the task status (so it lands
 * in the board's (other) column unless it matches a configured status). Idempotent: re-importing
 * overwrites the cache and prunes jira-sourced tasks no longer in the epic. Local tasks are untouched.
 * The fetch is injectable for deterministic tests.
 */
import { rmSync } from 'node:fs';
import type { TraceConfig } from '../config.js';
import { resolveTasksConfig } from '../config.js';
import type { Requirement } from '../types.js';
import { fetchJiraRequirements } from '../requirements/jiraEpic.js';
import { tasksDir } from '../store.js';
import { findTaskPath, listTasks, writeTask, type Task } from './model.js';
import { TaskError, today } from './ops.js';

export type JiraFetch = (epic: string) => Promise<Requirement[]>;

export interface ImportResult {
  imported: string[];
  pruned: string[];
}

export async function importJiraTasks(
  baseDir: string,
  config: TraceConfig,
  opts: { now?: string; fetch?: JiraFetch } = {},
): Promise<ImportResult> {
  const resolved = resolveTasksConfig(config);
  if (resolved.mode !== 'jira') throw new TaskError('`task import` requires tasks.mode: "jira".');
  if (!resolved.jira?.epic) throw new TaskError('tasks.jira.epic is required for mode: "jira".');

  const now = opts.now ?? today();
  const fetch = opts.fetch ?? ((epic: string) => fetchJiraRequirements(epic, { recursive: true, includeEpic: false }));
  const reqs = await fetch(resolved.jira.epic);

  const root = tasksDir(baseDir, resolved.dir);
  const fetched = new Set<string>();
  const imported: string[] = [];
  for (const r of reqs) {
    const id = r.key.toUpperCase();
    const task: Task = {
      id,
      title: r.title,
      status: r.declaredStatus ?? 'unknown',
      requirements: [],
      tests: [],
      assignee: null,
      source: 'jira',
      created: now,
      updated: now,
      body: r.url ? `Imported from Jira: ${r.url}` : 'Imported from Jira.',
    };
    writeTask(root, task);
    fetched.add(id);
    imported.push(id);
  }

  // Prune jira-sourced tasks that are no longer in the epic; never touch local tasks.
  const pruned: string[] = [];
  for (const t of listTasks(root)) {
    if (t.source === 'jira' && !fetched.has(t.id.toUpperCase())) {
      const p = findTaskPath(root, t.id);
      if (p) {
        rmSync(p);
        pruned.push(t.id);
      }
    }
  }
  return { imported: imported.sort(), pruned: pruned.sort() };
}
