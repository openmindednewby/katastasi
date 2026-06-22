# Changelog

All notable changes to **Katastasi** are documented here. Format: [Keep a Changelog](https://keepachangelog.com),
versioning: [SemVer](https://semver.org).

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
