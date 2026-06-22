/**
 * Bridge: turn `analyze`'s generated stories into native `.acp/tasks` linked to their requirement, so
 * the BA pipeline populates the board directly. Local mode only (jira/hybrid own tasks elsewhere).
 * Deduped by (title + requirement) so re-running analyze doesn't pile up duplicate tasks.
 */
import type { TraceConfig } from '../config.js';
import { resolveTasksConfig } from '../config.js';
import { addTask, listTasksFiltered } from './ops.js';

export interface AnalyzeTaskSeed {
  key: string; // the requirement key the story addresses
  title: string;
}

export function createTasksFromAnalyze(baseDir: string, config: TraceConfig, items: AnalyzeTaskSeed[], opts: { now?: string } = {}): string[] {
  if (resolveTasksConfig(config).mode !== 'local') return []; // only local mode owns native tasks
  const existing = listTasksFiltered(baseDir, config);
  const created: string[] = [];
  for (const item of items) {
    if (!item.title.trim() || !item.key) continue;
    const dup = existing.some((t) => t.title === item.title && t.requirements.includes(item.key));
    if (dup) continue;
    const task = addTask(baseDir, config, { title: item.title, requirements: [item.key] }, opts.now);
    created.push(task.id);
    existing.push(task); // dedupe within this batch too
  }
  return created;
}
