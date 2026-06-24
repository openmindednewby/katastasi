/**
 * The 3-way classifier — the safety core. Given the agreed **base** (last sync), the current **local**,
 * and the current **remote**, decide what a sync run should do. This is what guarantees "never silently
 * lose an edit": when BOTH sides changed to different values it returns `conflict` and the executor
 * applies nothing. Pure + total.
 */
import { recordsEqual, type SyncRecord } from './model.js';

export const enum SyncAction {
  Skip = 'skip', // neither side changed
  Push = 'push', // local changed, remote unchanged → write local → remote
  Pull = 'pull', // remote changed, local unchanged → write remote → local
  Converged = 'converged', // both changed to the SAME value → just re-baseline
  Conflict = 'conflict', // both changed to DIFFERENT values → flag, apply nothing
}

/** Classify one record from its three versions. `base` null = no prior sync (handled by the planner). */
export function classify(base: SyncRecord, local: SyncRecord, remote: SyncRecord): SyncAction {
  const localChanged = !recordsEqual(local, base);
  const remoteChanged = !recordsEqual(remote, base);
  if (!localChanged && !remoteChanged) return SyncAction.Skip;
  if (localChanged && !remoteChanged) return SyncAction.Push;
  if (!localChanged && remoteChanged) return SyncAction.Pull;
  // both changed
  return recordsEqual(local, remote) ? SyncAction.Converged : SyncAction.Conflict;
}

const FIELDS: Array<keyof SyncRecord> = ['title', 'body', 'status', 'labels'];

/** Does field `f` differ between two records? (trim-insensitive text; order-insensitive labels) */
export function fieldDiffers(a: SyncRecord, b: SyncRecord, f: keyof SyncRecord): boolean {
  if (f === 'title') return a.title.trim() !== b.title.trim();
  if (f === 'body') return a.body.trim() !== b.body.trim();
  if (f === 'status') return a.status !== b.status;
  return [...new Set(a.labels.map((l) => l.trim()))].sort().join(' ') !== [...new Set(b.labels.map((l) => l.trim()))].sort().join(' ');
}

/** Field-level diff between two records — which fields differ (for conflict reports). */
export function changedFields(a: SyncRecord, b: SyncRecord): Array<keyof SyncRecord> {
  return FIELDS.filter((f) => fieldDiffers(a, b, f));
}

/**
 * Field-level 3-way merge (sync v2). For each field: only-local-changed → take local; only-remote →
 * take remote; both changed to the same value → that value; both changed differently → a real conflict
 * (left at base, listed in `conflicts`). When `conflicts` is empty the `merged` record is safe to apply.
 */
export function fieldMerge(base: SyncRecord, local: SyncRecord, remote: SyncRecord): { merged: SyncRecord; conflicts: Array<keyof SyncRecord> } {
  const merged: SyncRecord = { title: base.title, body: base.body, status: base.status, labels: [...base.labels] };
  const conflicts: Array<keyof SyncRecord> = [];
  for (const f of FIELDS) {
    const lc = fieldDiffers(base, local, f);
    const rc = fieldDiffers(base, remote, f);
    if (lc && rc) {
      if (!fieldDiffers(local, remote, f)) assign(merged, local, f);
      else conflicts.push(f);
    } else if (lc) assign(merged, local, f);
    else if (rc) assign(merged, remote, f);
  }
  return { merged, conflicts };
}

function assign(target: SyncRecord, from: SyncRecord, f: keyof SyncRecord): void {
  if (f === 'labels') target.labels = [...from.labels];
  else target[f] = from[f] as never;
}
