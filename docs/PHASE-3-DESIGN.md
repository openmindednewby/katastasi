# Phase 3 — Bidirectional sync (incremental, safe)

> **v1 SHIPPED 2026-06-24.** Built per the build-start decisions: GitHub + Jira adapters, combined
> safe-both, `.acp/tasks ⇄ issues` incl. status, preview-default + auto-create + flag-deletions.
> User guide: **[SYNC.md](SYNC.md)**. v2 (field-merge) + v3 (interactive) still pending. This doc is the
> design record.

*Scope drafted 2026-06-23. The reconciliation layer: edit either side — local markdown or Jira /
Confluence / issues — and have them meet in the middle **without ever silently losing an edit**.
Implements the sync decision from [VISION.md](../VISION.md) §4. **Open questions in §6 are resolved at
build-start** (ask the owner first, same as Phases 1–2).*

## 1. Goal

Today `pull` writes a markdown folder and `push` **blindly overwrites** the remote from that folder — no
record of what the remote looked like at pull time, so a remote edit made in between is clobbered. Phase 3
replaces that with a **3-way reconciler**: it remembers the agreed state at the last sync (the *base*),
compares it against the current *local* and current *remote*, and applies only the changes that are safe —
**flagging anything that changed on both sides instead of guessing**.

**Done when (v1):** after a sync, editing either side and syncing again reconciles correctly — a change
made on only one side propagates; a change made on **both** sides is surfaced as a conflict (with base /
local / remote shown) and **neither version is lost**. Built incrementally: **v1** safe one-way +
conflict-flag → **v2** field-level auto-merge → **v3** interactive 3-way resolution.

## 2. Locked decisions (from [VISION.md](../VISION.md) §4–§5)

| Dimension | Decision |
|---|---|
| Shape | **Hybrid 3-way**: git detects local changes, a manifest tracks remote revisions, **field-aware**. |
| Increments | **v1** one-way + conflict-flag → **v2** field-level auto-merge → **v3** interactive 3-way. |
| Safety | **No silent merges.** Surface conflicts; never overwrite a side that changed since last sync. |
| Targets | Jira (tasks/issues), Confluence (docs), GitHub/GitLab issues (requirements) — all first-class. |
| Local SoT | Local markdown in the `.acp/` store stays the source of truth; remotes are projections. |

## 3. Proposed design (for discussion at build-start)

### The three versions (what makes it safe)
For every synced record we hold **base** (the agreed fields at the last sync), **local** (current
markdown), and **remote** (fetched now). The classification per record:

| local vs base | remote vs base | result |
|---|---|---|
| unchanged | unchanged | **skip** |
| changed | unchanged | **push** local → remote |
| unchanged | changed | **pull** remote → local |
| changed | changed (same value) | **converged** — just re-baseline |
| changed | changed (different) | **⚠️ conflict** — flag, apply nothing (v1) |

### Sync-state store — `.acp/sync/state.json`
The base snapshot + remote revision token per record (large bodies spill to `.acp/sync/base/<id>.md`):
```jsonc
{ "version": 1, "bindings": { "tasks-jira": { "records": {
  ".acp/tasks/TASK-1.md": {
    "remoteId": "PROJ-12",
    "remoteRev": "2026-06-20T10:00:00Z",     // Jira fields.updated | Confluence "version:7" | issue ETag
    "lastSyncedAt": "2026-06-22T09:00:00Z",
    "base": { "title": "Login", "body": "…", "status": "todo", "labels": ["auth"] }  // the 3-way base
  } } } } }
```
- **Local change** = `canonicalize(currentLocalFields) ≠ base` (a content compare; git's last-sync commit
  is recorded as an optional accelerator, but the hash/field compare is the robust source of truth).
- **Remote change** = `remoteRev` advanced (cheap gate) → then field compare vs `base`.

### Adapters (provider-agnostic, injectable for tests)
```ts
interface RemoteRecord { id: string; rev: string; fields: Record<string, string | string[]>; }
interface SyncAdapter {
  list(binding): Promise<RemoteRecord[]>;
  read(id): Promise<RemoteRecord>;
  create(fields): Promise<RemoteRecord>;
  update(id, fields, expectedRev): Promise<RemoteRecord>; // throws RevisionConflict if remote advanced
}
```
Real adapters wrap the existing `atlassian.ts` + `requirements/issues.ts` (and the ADF/storage
converters); a **fake in-memory adapter** drives every test with no network. `update` re-checks the
revision at write time (optimistic concurrency) and turns a mid-flight remote edit into a fresh conflict.

### Config — a `sync` block in `acp-trace.json`
```jsonc
"sync": {
  "mergeStrategy": "conflict-flag",          // conflict-flag (v1) | field-merge (v2) | interactive (v3)
  "bindings": [
    { "id": "tasks-jira", "local": ".acp/tasks", "kind": "task",
      "remote": { "type": "jira", "project": "PROJ", "epic": "PROJ-1" },
      "fields": ["title", "body", "status", "labels"],
      "statusMap": { "todo": "To Do", "in-progress": "In Progress", "done": "Done" },
      "create": true }
  ]
}
```

### Conflict surfacing
A conflicted record is **not applied**; both versions are written to
`.acp/sync/conflicts/<binding>/<id>.md` (base / local / remote per field) and listed in a sync report
(markdown + JSON). `katastasi sync --fail-on conflict` exits non-zero for CI.

### Surfaces
- **CLI** `katastasi sync` — **preview by default** (per-record status + conflicts, no writes);
  `--apply` to write; `--push`/`--pull` to pick the one-way direction (v1); `--binding <id>`,
  `--fail-on conflict`. Plus `katastasi sync status` (last-known drift) and (v3) `katastasi sync resolve`.
- **MCP** `sync_preview` / `sync_apply` (+ `sync_resolve` in v3).

## 4. Build plan (proposed, ordered, each tested with the fake adapter — network-free)

**v1 — safe one-way sync + conflict flag (ships as 0.5.0):**
1. **Sync-state store** — `.acp/sync/state.json` (+ base spill files): read/write, record identity, schema.
2. **Record model** — parse a local markdown record → typed fields; canonicalize for compare; fields → markdown (round-trip-safe, reusing the existing converters).
3. **3-way classifier** — pure function over `{base, local, remote}` → `skip | push | pull | converged | conflict` (record-level for v1).
4. **Adapter interface + fake in-memory adapter** + the **reconcile planner** (classify every record across a binding → a plan of creates / pushes / pulls / conflicts).
5. **Reconcile executor** — apply the plan with optimistic-concurrency writes, emit conflict files + a sync report, re-baseline state. Dry-run default; `--apply`.
6. **Jira adapter** — `list/read/create/update` over `atlassian.ts` (rev = `fields.updated`; `statusMap`).
7. **CLI `katastasi sync` (+ `status`) + MCP `sync_preview`/`sync_apply`** + the config `sync` block + docs (`docs/SYNC.md`).
8. **Confluence + GitHub/GitLab issue adapters** (rev = Confluence `version.number` / issue `updated_at`+ETag).

**v2 — field-level auto-merge ✅ (2026-06-24):**
9. **Field 3-way merge** — `fieldMerge(base,local,remote)` + a `merge` plan action + executor (writes the
   merged record to both sides, optimistic-concurrency safe, needs direction `both`); `sync.mergeStrategy:
   "field-merge"`. Disjoint-field edits merge; same-field divergence stays a conflict.

**v3 — interactive resolution (ships as 0.7.0):**
10. **Interactive resolver** — `katastasi sync resolve <id> --take local|remote` (and edit) + a portal
    conflict view; records the resolution and continues. `mergeStrategy: interactive`.
11. **Docs pass + release** per sub-phase.

## 5. Out of scope (later / never)
Real-time/webhook-driven sync (Phase 4+); >2 endpoints reconciled for one record; comment/attachment sync;
structural body merge inside one Confluence page (v1 treats the body as a single field — section-level
diffing is a later refinement); rewriting the existing one-shot `pull`/`push` (they stay as the
fire-and-forget path; `sync` is the stateful, safe path alongside them).

## 6. Open questions to resolve at build-start (ask the owner first)
1. **Direction model** — keep v1 strictly **one-way per run** (`--push` / `--pull`, conflict-flag protects
   the other side; the VISION-locked default) **or** also offer a combined run that applies *both* safe
   directions at once (push local-only-changed + pull remote-only-changed, flag both-changed)? (Proposed:
   ship the combined safe-both as the default `sync`, with `--push-only`/`--pull-only` to restrict.)
2. **Local-change detection** — content-hash/field-compare vs the stored base (git-independent; proposed)
   vs a git diff against the recorded last-sync commit vs both? How much should git be relied on?
3. **State-store layout** — dedicated `.acp/sync/state.json` + base spill files (proposed) vs extending
   the existing `acp-pull.json` manifest? Keep the legacy `pull`/`push` untouched?
4. **Field granularity** — for Confluence/doc bodies, treat the **whole body as one field** in v1
   (proposed) vs diff by section/heading now? For issues, confirm fields = title/body/status/labels/priority.
5. **Status sync** — is `status` synced bidirectionally in v1 (needs the `statusMap`), or v1 does
   title+body only and status lands with v2? How are unmapped statuses handled (skip + warn)?
6. **Record identity & creation** — local-origin records with no remote yet: auto-`create` remotely and
   write the new id back into the markdown frontmatter + state? Confirm the local-path ↔ remote-id map
   lives in the sync state. How are remote deletions / local deletions treated (tombstone vs ignore)?
7. **Conflict output** — a report + `.acp/sync/conflicts/<id>.md` (base/local/remote, proposed) vs inline
   git-style markers in the record vs a `.rej` sidecar? Does any conflict fail the whole run, or just that
   record (rest proceed)?
8. **Providers in v1** — validate on **Jira (tasks↔issues)** first then add Confluence + issues right
   after (engine generic throughout; proposed), or wire all three in the first release?
9. **Safety rails** — preview-by-default + explicit `--apply` (proposed); always snapshot pre-write
   local+remote into `.acp/sync/base` so nothing is unrecoverable; a `--backup` of overwritten content?
10. **Optimistic concurrency** — re-fetch the remote rev immediately before each write and abort that
    record as a fresh conflict if it advanced (proposed), vs trust the plan computed at the start of the run?
