# Bidirectional sync (`katastasi sync`)

> Phase 3 v1. Edit your tasks as **local markdown** *or* as **GitHub issues / Jira** — and have them meet
> in the middle **without ever silently losing an edit**. A 3-way reconciler (base / local / remote)
> flags anything changed on both sides instead of guessing. Preview by default; `--apply` to write.

## How it stays safe

For every synced record it remembers the **base** (the agreed state at the last sync) and compares it to
the current **local** and **remote**:

| local vs base | remote vs base | result |
|---|---|---|
| unchanged | unchanged | skip |
| changed | unchanged | **push** → |
| unchanged | changed | **pull** ← |
| changed | changed (same value) | re-baseline |
| **changed** | **changed (different)** | **⚠️ conflict** — written to `.acp/sync/conflicts/`, nothing applied |

A `katastasi sync` run does **both** safe directions at once (push local-only, pull remote-only, flag
both-changed). New local tasks **create** an issue (and the id is written back into the task); new issues
**create** a local task. A vanished local or remote record is **flagged, never auto-deleted**. Writes use
optimistic concurrency — if the remote moved between plan and write, that record becomes a fresh conflict.

## Configure

Add a `sync` block to `acp-trace.json` (credentials come from env, never config):

```jsonc
"sync": {
  "bindings": [
    {
      "id": "tasks-github",
      "remote": { "type": "github", "repo": "owner/name", "labelFilter": "katastasi" },
      "statusMap": { "todo": "open", "in-progress": "open", "blocked": "open", "done": "closed" }
    }
    // or Jira:
    // { "id": "tasks-jira",
    //   "remote": { "type": "jira", "jql": "project = PROJ", "projectKey": "PROJ", "issueType": "Task" },
    //   "statusMap": { "todo": "To Do", "in-progress": "In Progress", "done": "Done" } }
  ]
}
```

- **`statusMap`** maps your local status → the remote's vocabulary (GitHub `open`/`closed`, Jira status
  names). The reverse uses the first local mapped to each remote value (so list order picks the
  representative, e.g. `open` → `todo`). Status round-trips: marking a task `done` closes the issue, and
  closing the issue marks the task `done`.
- **`labelFilter`** (GitHub) / **`jql`** (Jira) scope which remote records are in play.
- Credentials: `GITHUB_TOKEN` for GitHub; `JIRA_BASE_URL` / `JIRA_EMAIL` / `JIRA_API_TOKEN` for Jira.
  First-time setup: **[SOURCES_SETUP.md](SOURCES_SETUP.md)**. (A GitHub token: GitHub → Settings →
  Developer settings → Personal access tokens; needs `repo` / issues scope.)

## Use

```bash
katastasi sync                 # PREVIEW: what would push / pull / conflict (no writes)
katastasi sync --apply         # do it (both safe directions)
katastasi sync --apply --push-only   # only push local changes
katastasi sync --apply --pull-only   # only pull remote changes
katastasi sync --binding tasks-github --apply
katastasi sync --apply --fail-on conflict   # CI: exit non-zero if anything conflicts
katastasi sync status          # the recorded task↔remote links (no network)
```

Resolve a conflict by editing the local task (or the remote) to the value you want, then re-run `sync` —
once only one side differs from the base, it applies cleanly. Conflict details (base / local / remote per
field) are in `.acp/sync/conflicts/<binding>/<id>.md`.

## State & files

- `.acp/sync/state.json` — the per-record base snapshot + remote revision (the link + 3-way base).
- `.acp/sync/conflicts/` — one markdown file per unresolved conflict.

Both are local machine state (git-ignored); the source of truth stays your `.acp/tasks` markdown.

## MCP

`sync_preview` and `sync_apply` — `{ configPath?, direction?, binding? }` — let a coding agent preview or
apply the sync and report pushes / pulls / conflicts.

## Scope (v1) & what's next

- v1 binds **`.acp/tasks` ⇄ GitHub issues / Jira** with title + body + labels + status; **combined
  safe-both**; conflict-flagging.
- **v2 ✅** — **field-level auto-merge**: set `sync.mergeStrategy: "field-merge"` in `acp-trace.json` and
  when both sides changed *different* fields they merge automatically (each side's field wins); only a
  *same-field* divergence stays a conflict. Default stays `conflict-flag`.
- **v3** — interactive conflict resolution (`sync resolve --take local|remote`).
- Confluence docs and requirement bindings come after. Design: **[PHASE-3-DESIGN.md](PHASE-3-DESIGN.md)**.
