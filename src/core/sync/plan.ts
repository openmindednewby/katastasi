/**
 * Reconcile planner — turns the three inputs (local records, remote records, prior sync state) into a
 * flat, side-effect-free plan. Every local/remote record lands in exactly one bucket. The executor then
 * applies the safe subset. This is where "combined safe-both" lives: local-only → push, remote-only →
 * pull, both-same → converged, both-different → conflict, unseen local → create-remote, unseen remote →
 * pull-create; a vanished local or remote is flagged (never auto-deleted).
 */
import { changedFields, classify, fieldMerge, SyncAction } from './classify.js';
import type { SyncRecord } from './model.js';
import type { RemoteRecord } from './model.js';
import type { RecordState } from './state.js';
import type { LocalRecord } from './localTasks.js';

export type PlanAction =
  | 'skip'
  | 'push' // local → remote (update)
  | 'pull' // remote → local (update)
  | 'create-remote' // new local, no remote yet → create remote + link
  | 'pull-create' // new remote, no local yet → create local + link
  | 'converged' // both changed to the same value → just re-baseline
  | 'merge' // both changed in DISJOINT fields → auto-merge (v2 field-merge)
  | 'conflict' // both changed the SAME field differently → flag, apply nothing
  | 'local-deleted' // linked, local file gone, remote remains → flag
  | 'remote-deleted'; // linked, remote gone, local remains → flag

export type MergeStrategy = 'conflict-flag' | 'field-merge';

export interface PlanItem {
  action: PlanAction;
  key?: string; // local record key (repo-relative path)
  path?: string; // local absolute path
  remoteId?: string;
  remoteRev?: string;
  remoteUrl?: string;
  local?: SyncRecord;
  remote?: SyncRecord;
  base?: SyncRecord;
  merged?: SyncRecord; // for action 'merge'
  conflictFields?: string[];
}

export interface Plan {
  items: PlanItem[];
}

const FROM_CLASSIFY: Record<SyncAction, PlanAction> = {
  [SyncAction.Skip]: 'skip',
  [SyncAction.Push]: 'push',
  [SyncAction.Pull]: 'pull',
  [SyncAction.Converged]: 'converged',
  [SyncAction.Conflict]: 'conflict',
};

export function planSync(
  locals: LocalRecord[],
  remotes: RemoteRecord[],
  state: Record<string, RecordState>,
  mergeStrategy: MergeStrategy = 'conflict-flag',
): Plan {
  const items: PlanItem[] = [];
  const remoteById = new Map(remotes.map((r) => [r.id, r]));
  const localByKey = new Map(locals.map((l) => [l.key, l]));
  const linkedRemoteIds = new Set<string>();

  // 1. Walk local records.
  for (const l of locals) {
    const st = state[l.key];
    if (!st) {
      items.push({ action: 'create-remote', key: l.key, path: l.path, local: l.record });
      continue;
    }
    linkedRemoteIds.add(st.remoteId);
    const remote = remoteById.get(st.remoteId);
    if (!remote) {
      items.push({ action: 'remote-deleted', key: l.key, path: l.path, remoteId: st.remoteId, local: l.record, base: st.base });
      continue;
    }
    const item: PlanItem = {
      action: FROM_CLASSIFY[classify(st.base, l.record, remote.fields)],
      key: l.key, path: l.path, remoteId: remote.id, remoteRev: remote.rev, remoteUrl: remote.url,
      local: l.record, remote: remote.fields, base: st.base,
    };
    if (item.action === 'conflict') {
      if (mergeStrategy === 'field-merge') {
        const { merged, conflicts } = fieldMerge(st.base, l.record, remote.fields);
        if (conflicts.length === 0) {
          item.action = 'merge';
          item.merged = merged;
        } else {
          item.conflictFields = conflicts;
        }
      } else {
        item.conflictFields = changedFields(l.record, remote.fields);
      }
    }
    items.push(item);
  }

  // 2. Linked-in-state but the local file vanished → local-deleted.
  for (const [key, st] of Object.entries(state)) {
    if (localByKey.has(key)) continue;
    linkedRemoteIds.add(st.remoteId);
    const remote = remoteById.get(st.remoteId);
    items.push({ action: 'local-deleted', key, remoteId: st.remoteId, remote: remote?.fields, base: st.base });
  }

  // 3. Remote records never linked to any local → pull-create.
  for (const r of remotes) {
    if (linkedRemoteIds.has(r.id)) continue;
    items.push({ action: 'pull-create', remoteId: r.id, remoteRev: r.rev, remoteUrl: r.url, remote: r.fields });
  }

  return items.length ? { items } : { items: [] };
}

/** Compact counts for the summary line. */
export function planSummary(plan: Plan): Record<PlanAction, number> {
  const out = { skip: 0, push: 0, pull: 0, 'create-remote': 0, 'pull-create': 0, converged: 0, merge: 0, conflict: 0, 'local-deleted': 0, 'remote-deleted': 0 } as Record<PlanAction, number>;
  for (const i of plan.items) out[i.action] += 1;
  return out;
}
