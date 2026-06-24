/**
 * In-memory `SyncAdapter` for tests — models a remote with monotonic revisions and optimistic
 * concurrency, so the whole engine (planner + executor + conflict handling) runs with no network.
 * `editRemote` simulates an out-of-band remote change (advancing the revision) to drive pull/conflict.
 */
import { RevisionConflict, type RemoteRecord, type SyncAdapter, type SyncRecord } from '../model.js';

function clone(r: RemoteRecord): RemoteRecord {
  return { ...r, fields: { ...r.fields, labels: [...r.fields.labels] } };
}

export class FakeAdapter implements SyncAdapter {
  private store = new Map<string, RemoteRecord>();
  private seq = 0;

  constructor(initial: RemoteRecord[] = []) {
    for (const r of initial) this.store.set(r.id, clone(r));
  }

  private nextRev(): string {
    return `rev-${++this.seq}`;
  }

  async list(): Promise<RemoteRecord[]> {
    return [...this.store.values()].map(clone);
  }

  async read(id: string): Promise<RemoteRecord> {
    const r = this.store.get(id);
    if (!r) throw new Error(`fake: no remote ${id}`);
    return clone(r);
  }

  async create(fields: SyncRecord): Promise<RemoteRecord> {
    const id = `ISSUE-${++this.seq}`;
    const rec: RemoteRecord = { id, rev: this.nextRev(), fields: { ...fields, labels: [...fields.labels] } };
    this.store.set(id, rec);
    return clone(rec);
  }

  async update(id: string, fields: SyncRecord, expectedRev: string): Promise<RemoteRecord> {
    const cur = this.store.get(id);
    if (!cur) throw new Error(`fake: no remote ${id}`);
    if (cur.rev !== expectedRev) throw new RevisionConflict(id, expectedRev, cur.rev);
    const rec: RemoteRecord = { ...cur, rev: this.nextRev(), fields: { ...fields, labels: [...fields.labels] } };
    this.store.set(id, rec);
    return clone(rec);
  }

  // ── test helpers ──────────────────────────────────────────────────────────
  /** Simulate an external edit to the remote (advances the revision). */
  editRemote(id: string, patch: Partial<SyncRecord>): RemoteRecord {
    const cur = this.store.get(id);
    if (!cur) throw new Error(`fake: no remote ${id}`);
    const rec: RemoteRecord = { ...cur, rev: this.nextRev(), fields: { ...cur.fields, ...patch, labels: patch.labels ?? cur.fields.labels } };
    this.store.set(id, rec);
    return clone(rec);
  }

  deleteRemote(id: string): void {
    this.store.delete(id);
  }

  get(id: string): RemoteRecord | undefined {
    const r = this.store.get(id);
    return r ? clone(r) : undefined;
  }
}
