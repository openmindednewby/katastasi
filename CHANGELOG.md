# Changelog

All notable changes to **Katastasi** are documented here. Format: [Keep a Changelog](https://keepachangelog.com),
versioning: [SemVer](https://semver.org).

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
