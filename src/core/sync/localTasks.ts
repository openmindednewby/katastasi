/**
 * Local side of the tasks⇄issues binding: map a `.acp/tasks` Task to/from the canonical `SyncRecord`,
 * list local records with their repo-relative path (the state key), write a reconciled record back into
 * its task file, and create a brand-new task from a pulled remote record. Status stays the LOCAL
 * vocabulary here; the adapters translate to/from the remote's open/closed (or Jira status).
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { allocateId, readTask, writeTask, type Task } from '../trace/tasks/model.js';
import type { SyncRecord } from './model.js';

export interface LocalRecord {
  path: string; // absolute file path
  key: string; // repo-relative, forward-slash (the sync-state key)
  task: Task;
  record: SyncRecord;
}

export function taskToRecord(task: Task): SyncRecord {
  return { title: task.title, body: task.body, status: task.status, labels: task.labels ?? [] };
}

/** Apply a reconciled record onto a task (title/body/status/labels), stamping `updated`. */
export function applyRecord(task: Task, record: SyncRecord, today: string): Task {
  const next: Task = { ...task, title: record.title, body: record.body, status: record.status, updated: today };
  if (record.labels.length) next.labels = [...record.labels];
  else delete next.labels;
  return next;
}

function relKey(baseDir: string, path: string): string {
  return relative(baseDir, path).replace(/\\/g, '/');
}

/** Every task under `tasksRoot`, with its path + canonical record. */
export function listLocalRecords(baseDir: string, tasksRoot: string): LocalRecord[] {
  if (!existsSync(tasksRoot)) return [];
  const out: LocalRecord[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (entry.endsWith('.md') && entry !== 'BOARD.md') {
        const task = readTask(p);
        out.push({ path: p, key: relKey(baseDir, p), task, record: taskToRecord(task) });
      }
    }
  };
  walk(tasksRoot);
  return out;
}

/** Write a reconciled record back into an existing task file (same path). */
export function writeRecordToTask(path: string, record: SyncRecord, today: string): void {
  const updated = applyRecord(readTask(path), record, today);
  writeTask(dirname(path), updated);
}

/** Create a new local task from a pulled remote record. Returns the new path + relative key. */
export function createTaskFromRecord(
  baseDir: string,
  tasksRoot: string,
  record: SyncRecord,
  idPrefix: string,
  today: string,
): { path: string; key: string; task: Task } {
  const task: Task = {
    id: allocateId(baseDir, idPrefix),
    title: record.title,
    status: record.status,
    requirements: [],
    tests: [],
    assignee: null,
    source: 'local',
    created: today,
    updated: today,
    body: record.body,
    ...(record.labels.length ? { labels: [...record.labels] } : {}),
  };
  const path = writeTask(tasksRoot, task);
  return { path, key: relKey(baseDir, path), task };
}
