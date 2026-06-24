/**
 * Reconcile executor — applies a plan's SAFE subset. Preview by default (no writes); `apply` performs
 * them. Pushes/pulls re-baseline the state (so the next run sees them as the agreed base); creates link
 * the new id back into the task; conflicts (incl. a write-time revision race) are written to
 * `.acp/sync/conflicts/` and never applied; vanished records are flagged. Direction can be restricted to
 * push-only / pull-only. Nothing here throws on a per-record failure — it's collected into `errors`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { RevisionConflict, type SyncAdapter, type SyncRecord } from './model.js';
import type { Plan, PlanAction, PlanItem } from './plan.js';
import { planSummary } from './plan.js';
import { conflictPath, type RecordState } from './state.js';
import { createTaskFromRecord, linkTaskRemote, writeRecordToTask } from './localTasks.js';
import { identityMapper, type StatusMapper } from './statusMapper.js';

export type Direction = 'both' | 'push' | 'pull';

export interface ExecuteOptions {
  baseDir: string;
  bindingId: string;
  tasksRoot: string;
  idPrefix: string;
  today: string;
  apply: boolean; // false = preview
  direction: Direction;
  mapper?: StatusMapper; // local↔remote status mapping (default identity)
}

export interface SyncResult {
  applied: boolean;
  summary: Record<PlanAction, number>;
  conflicts: Array<{ key?: string; remoteId?: string; fields?: string[]; file?: string }>;
  links: Array<{ key: string; remoteId: string; url?: string }>;
  flags: Array<{ action: PlanAction; key?: string; remoteId?: string }>;
  errors: Array<{ key?: string; remoteId?: string; message: string }>;
}

function fieldBlock(label: string, r?: SyncRecord): string {
  if (!r) return `### ${label}\n(absent)\n`;
  return `### ${label}\n- title: ${r.title}\n- status: ${r.status}\n- labels: ${r.labels.join(', ')}\n\n${r.body}\n`;
}

function renderConflict(item: PlanItem, fields: string[]): string {
  return [
    `# Conflict: ${item.key ?? '(unknown)'} ↔ ${item.remoteId ?? '(unknown)'}`,
    '',
    `Both sides changed since the last sync. Resolve by editing the local task (or the remote), then re-run \`katastasi sync\`.`,
    `Diverging field(s): **${fields.join(', ') || 'unknown'}**`,
    '',
    fieldBlock('base', item.base),
    fieldBlock('local', item.local),
    fieldBlock('remote', item.remote),
  ].join('\n');
}

function writeConflictFile(opts: ExecuteOptions, item: PlanItem, fields: string[]): string {
  const path = conflictPath(opts.baseDir, opts.bindingId, item.remoteId ?? item.key ?? 'unknown');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderConflict(item, fields), 'utf8');
  return path;
}

function allows(direction: Direction, action: PlanAction): boolean {
  const isPush = action === 'push' || action === 'create-remote';
  const isPull = action === 'pull' || action === 'pull-create';
  if (direction === 'push') return !isPull;
  if (direction === 'pull') return !isPush;
  return true;
}

/**
 * Apply (or preview) a plan. Mutates `records` (the binding's state map) in place when applying, so the
 * caller can persist it afterwards.
 */
export async function executeSync(
  plan: Plan,
  adapter: SyncAdapter,
  records: Record<string, RecordState>,
  opts: ExecuteOptions,
): Promise<SyncResult> {
  const res: SyncResult = { applied: opts.apply, summary: planSummary(plan), conflicts: [], links: [], flags: [], errors: [] };
  const mapper = opts.mapper ?? identityMapper;
  const baseline = (key: string, remoteId: string, remoteRev: string, base: SyncRecord): void => {
    records[key] = { remoteId, remoteRev, base, lastSyncedAt: opts.today };
  };

  for (const item of plan.items) {
    try {
      if (item.action === 'conflict') {
        const fields = item.conflictFields ?? [];
        const file = opts.apply ? writeConflictFile(opts, item, fields) : undefined;
        res.conflicts.push({ key: item.key, remoteId: item.remoteId, fields, file });
        continue;
      }
      if (item.action === 'local-deleted' || item.action === 'remote-deleted') {
        res.flags.push({ action: item.action, key: item.key, remoteId: item.remoteId });
        continue;
      }
      if (item.action === 'skip') continue;
      if (item.action === 'converged') {
        if (opts.apply && item.key && item.remoteId && item.remoteRev && item.local) baseline(item.key, item.remoteId, item.remoteRev, item.local);
        continue;
      }
      if (!allows(opts.direction, item.action)) continue; // direction-restricted
      if (!opts.apply) continue; // preview: count only (summary already has it)

      if (item.action === 'push' && item.key && item.remoteId && item.local) {
        try {
          const updated = await adapter.update(item.remoteId, item.local, item.remoteRev ?? '');
          baseline(item.key, updated.id, updated.rev, item.local);
        } catch (err) {
          if (err instanceof RevisionConflict) {
            const fresh = await adapter.read(item.remoteId);
            const file = writeConflictFile(opts, { ...item, remote: fresh.fields }, ['(remote changed mid-write)']);
            res.conflicts.push({ key: item.key, remoteId: item.remoteId, fields: ['concurrent'], file });
          } else throw err;
        }
      } else if (item.action === 'pull' && item.key && item.path && item.remote && item.remoteId && item.remoteRev) {
        writeRecordToTask(item.path, item.remote, opts.today, mapper);
        baseline(item.key, item.remoteId, item.remoteRev, item.remote);
      } else if (item.action === 'create-remote' && item.key && item.path && item.local) {
        const created = await adapter.create(item.local);
        linkTaskRemote(item.path, created.id, created.url);
        baseline(item.key, created.id, created.rev, item.local);
        res.links.push({ key: item.key, remoteId: created.id, url: created.url });
      } else if (item.action === 'pull-create' && item.remoteId && item.remote && item.remoteRev) {
        const made = createTaskFromRecord(opts.baseDir, opts.tasksRoot, item.remote, opts.idPrefix, opts.today, { remoteId: item.remoteId, remoteUrl: item.remoteUrl }, mapper);
        baseline(made.key, item.remoteId, item.remoteRev, item.remote);
        res.links.push({ key: made.key, remoteId: item.remoteId, url: item.remoteUrl });
      }
    } catch (err) {
      res.errors.push({ key: item.key, remoteId: item.remoteId, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return res;
}
