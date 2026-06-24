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
import { identityMapper, type StatusMapper } from './statusMapper.js';

export interface LocalRecord {
  path: string; // absolute file path
  key: string; // repo-relative, forward-slash (the sync-state key)
  task: Task;
  record: SyncRecord;
}

export function taskToRecord(task: Task, mapper: StatusMapper = identityMapper): SyncRecord {
  return { title: task.title, body: task.body, status: mapper.toRemote(task.status), labels: task.labels ?? [] };
}

/** Apply a reconciled record onto a task (title/body/status/labels), stamping `updated`. */
export function applyRecord(task: Task, record: SyncRecord, today: string, mapper: StatusMapper = identityMapper): Task {
  const next: Task = { ...task, title: record.title, body: record.body, status: mapper.toLocal(record.status), updated: today };
  if (record.labels.length) next.labels = [...record.labels];
  else delete next.labels;
  return next;
}

function relKey(baseDir: string, path: string): string {
  return relative(baseDir, path).replace(/\\/g, '/');
}

/** Every task under `tasksRoot`, with its path + canonical record. */
export function listLocalRecords(baseDir: string, tasksRoot: string, mapper: StatusMapper = identityMapper): LocalRecord[] {
  if (!existsSync(tasksRoot)) return [];
  const out: LocalRecord[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (entry.endsWith('.md') && entry !== 'BOARD.md') {
        const task = readTask(p);
        out.push({ path: p, key: relKey(baseDir, p), task, record: taskToRecord(task, mapper) });
      }
    }
  };
  walk(tasksRoot);
  return out;
}

/** Write a reconciled record back into an existing task file (same path). */
export function writeRecordToTask(path: string, record: SyncRecord, today: string, mapper: StatusMapper = identityMapper): void {
  const updated = applyRecord(readTask(path), record, today, mapper);
  writeTask(dirname(path), updated);
}

/** Write the linked remote id/url into a task's frontmatter (visible link after create). */
export function linkTaskRemote(path: string, remoteId: string, remoteUrl: string | undefined): void {
  const task = readTask(path);
  task.remoteId = remoteId;
  if (remoteUrl) task.remoteUrl = remoteUrl;
  writeTask(dirname(path), task);
}

/** Create a new local task from a pulled remote record. Returns the new path + relative key. */
export function createTaskFromRecord(
  baseDir: string,
  tasksRoot: string,
  record: SyncRecord,
  idPrefix: string,
  today: string,
  link?: { remoteId: string; remoteUrl?: string },
  mapper: StatusMapper = identityMapper,
): { path: string; key: string; task: Task } {
  const task: Task = {
    id: allocateId(baseDir, idPrefix),
    title: record.title,
    status: mapper.toLocal(record.status),
    requirements: [],
    tests: [],
    assignee: null,
    source: 'local',
    created: today,
    updated: today,
    body: record.body,
    ...(record.labels.length ? { labels: [...record.labels] } : {}),
    ...(link ? { remoteId: link.remoteId, ...(link.remoteUrl ? { remoteUrl: link.remoteUrl } : {}) } : {}),
  };
  const path = writeTask(tasksRoot, task);
  return { path, key: relKey(baseDir, path), task };
}
