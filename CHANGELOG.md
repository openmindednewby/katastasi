# Changelog

All notable changes to **Katastasi** are documented here. Format: [Keep a Changelog](https://keepachangelog.com),
versioning: [SemVer](https://semver.org).

## [Unreleased] — Feature Lifecycle Wizard (slice 1)

A guided idea→dev-ready-pack flow (design: [docs/WIZARD-DESIGN.md](docs/WIZARD-DESIGN.md)).

### Added
- **`katastasi wizard`** — source (Jira/Confluence/both/none) → requirements (new/pull/clean) → `analyze`
  (system + per-use-case mermaid + gaps) → ordered context-rich tasks → unit/e2e/acceptance stubs +
  ready-made curls → a self-contained **HTML feature pack** (read → approve → run curls → verify) + a
  markdown mirror (+ optional Confluence). Interactive in a TTY; flag-driven otherwise. Generates only.
- **`katastasi wizard check`** — credential doctor for Jira/Confluence; prints exactly what's missing.
- **First-time auth guide** — [docs/SOURCES_SETUP.md](docs/SOURCES_SETUP.md) (Atlassian API token → `.env`).
- **MCP `feature_wizard`** (20 tools) so a coding agent can produce the pack.
- **System + per-use-case data-flow mermaid** — `analyze` emits an explicit end-to-end `systemDiagram`
  (client → endpoints → services → stores, labelled edges) + a per-task data-flow; written into the
  Confluence doc and shown first in the feature pack.
- **Dependency-ordered, context-rich tasks** — `analyze` emits per-task `dependsOn` + relevant `files`;
  the wizard topo-orders the tasks and inlines code files + the requirement link + prerequisites, so an
  executing agent has everything it needs without hunting.
- **Ready-made curls with real ids** — a `wizard.fixtures` config map fills `{id}` / `:id` / `{{id}}`
  placeholders in curl paths + bodies; unresolved names are flagged. Plus a `wizard.baseUrl`.
- **Requirement-change diff** — a re-run diffs the requirements against a per-feature snapshot and shows
  what was added / changed / removed (in the pack + CLI), instead of a blind regenerate.

### Notes
- Slice 1 wraps the existing `pull-requirements` / `analyze` / `task` / acceptance machinery. Later
  phases (per-design): per-endpoint data-flow diagrams, dependency task ordering, curl id-sourcing,
  approve/verify export, requirement-change diff.

## [Unreleased] — DB-changes + agent skills

### Added
- **DB / migration changes** — the wizard asks "does this feature need DB changes?" (`--db-changes`);
  on yes, `analyze` enumerates every required migration into a "Database / migration changes" checklist
  in the technical-analysis doc (→ Confluence) + the feature pack, so the list is ready at migration time.
- **`katastasi init-skills`** — install agent skills into any repo (`.claude/skills/*` +
  `.github/copilot-instructions.md`) so Claude Code & Copilot drive every action (onboard / design / sync
  / trace / test / tasks) as one-liners. Idempotent; run once per service.

## [Unreleased] — Bidirectional sync v1 (Phase 3)

A 3-way reconciler for `.acp/tasks ⇄ GitHub issues / Jira` — never silently loses an edit
(guide: [docs/SYNC.md](docs/SYNC.md)).

### Added
- **`katastasi sync`** — combined safe-both reconcile (push local-only, pull remote-only, flag
  both-changed), preview by default, `--apply` to write, `--push-only`/`--pull-only`, `--binding`,
  `--fail-on conflict`. `katastasi sync status` shows the recorded links.
- **3-way core** — base/local/remote classifier (skip/push/pull/converged/conflict); `.acp/sync/state.json`
  (per-record base snapshot + remote revision); conflicts written to `.acp/sync/conflicts/`, never applied.
- **Adapters** — GitHub Issues + Jira (token/Basic auth, optimistic concurrency via revision re-check,
  status round-trip via a `statusMap`, Jira body as markdown⇄ADF). New `sync` config block (creds from env).
- **Auto-create + link** — a new local task creates an issue and writes its id/url back into the task
  frontmatter (new optional `labels`/`remoteId`/`remoteUrl` Task fields); a new issue creates a task.
  Deletions are flagged, never auto-applied.
- **MCP** — `sync_preview` / `sync_apply` (22 tools).

### Notes
- v1 is conflict-flagging (no auto-merge). v2 = field-level merge; v3 = interactive resolution.

## [0.4.0] — 2026-06-22 — Acceptance test runner (Phase 2)

A built-in **requirement-first acceptance runner** — the third pillar (see
[docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)). Existing Jest/Playwright suites stay *linked*, not replaced.

### Added
- **`katastasi test`** — run acceptance cases (HTTP/REST **and** CLI/process) and write JUnit results
  keyed by requirement, so `trace` flips a requirement to ✅ verified on pass (and clears task drift).
  Flags: `--req`, `--base-url`, `--specs`, `--out`, `--fail-on`.
- **Authoring, four ways** — spec files `.acp/tests/<KEY>.acp.json` / `.acp.yml` (hand-rolled YAML-lite) /
  `.acp.md` (markdown table), and inline ` ```acp-test ` blocks under a requirement (terse one-liners
  **or** JSON), all parsing into one model.
- **Steps & assertions** — HTTP (method/url/body/headers) and `run` (CLI); assert `status`/`exit`,
  JSON-path (`$.a.b` → `exists`/`absent`/equals), header, body-contains; **capture** variables for
  step-to-step chaining; `{{var}}` / `{{env.NAME}}` interpolation (secrets from env only).
- **`runner` config block** — `baseUrl`, default `headers`, and a one-time `setup`/login whose captured
  variables seed every case. New `tech: "acceptance"` test source.
- **`analyze`** now emits executable acceptance specs (`.acp/tests/<KEY>.acp.json` + an inline block in
  the story) — an AI-generated requirement ships self-verifying.
- **MCP** — `test_run` (now 19 tools).

### Changed
- JUnit emission reuses the existing `trace` ingestion — no new result pipeline. No breaking changes.

## [0.3.0] — 2026-06-22 — Task tracking (Phase 1)

Native, local, markdown-first task tracking — the second pillar (see
[docs/PHASE-1-DESIGN.md](docs/PHASE-1-DESIGN.md)).

### Added
- **`.acp/` store** — a tidy hidden home for tasks/requirements/runs/tech-analysis; legacy root dirs are
  still read, and `katastasi migrate` moves them in.
- **Tasks** — `katastasi task add / list / show / set / link / board / verify / import`. Markdown tasks
  (`.acp/tasks/*.md`) link to requirements (many-to-many); configurable statuses; global `TASK-<n>` or
  per-scope (`WEB-<n>`) ids; a generated kanban board (`.acp/BOARD.md`).
- **Honesty cross-check** — a `done` task whose linked requirements aren't verified is flagged ⚠️ drift
  (`tasks.driftRule`: unverified / strict / failing); `task verify --fail-on drift` gates CI.
- **Modes** — `local` (full), `jira` (read-only import via `task import`), `hybrid` (Phase 3).
- **MCP** — `task_add / task_list / task_set_status / task_link / task_board / task_import` (18 tools).
- **`analyze`** now drops its generated stories onto the native board.

### Changed
- `pull-requirements`, `analyze`, and trace run-history default their output into `.acp/` (legacy root
  paths still read). No breaking changes to existing commands or config.

## [0.2.0] — 2026-06-22 — Rebrand to Katastasi (Phase 0)

The project is now **Katastasi** — an open-source documentation, task-tracking, and testing framework
(see [VISION.md](VISION.md)). This release is the identity + distribution unlock; no capabilities were
removed.

### Changed
- **Renamed** `ai-confluence-pipeline` → `katastasi`. Primary binary is `katastasi` (alias `kat`);
  `acp` / `acp-mcp` continue to work through the transition.
- README now leads with the framework (documentation · task-tracking · testing). The n8n AI-publishing
  flow is retained as an optional **"AI authoring"** add-on.
- MCP server identifies as `katastasi`.

### Added
- **Distribution:** published to npm as `katastasi` and `@dloizides/katastasi`; a public Docker image on
  GHCR (`ghcr.io/openmindednewby/katastasi`); a published GitHub Action (`uses: openmindednewby/katastasi@v1`);
  GitLab CI + pre-commit templates in `docs/ci/`.
- `VISION.md`, this `CHANGELOG.md`, and CI/release GitHub workflows.

### Notes
- No breaking changes to commands or config. `acp-trace.json` and all `acp …` invocations still work.

---

Earlier history (pre-rebrand, as `ai-confluence-pipeline`): markdown ⇄ Jira/Confluence (both ways),
`acp trace` (requirements traceability + regression pipeline), `acp analyze` / `acp pipeline` (BA →
development-ready flow), `acp questions` (interactive decisions), company-agnostic sources/sinks, and the
MCP server. See the git log for details.
