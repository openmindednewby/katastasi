# Katastasi

**The open-source documentation, task-tracking & testing framework that keeps your project honest.**

> *Katastasi* (Greek *κατάστασις*, "status / state") answers the question every team fumbles:
> **what is the real status — is this actually done, and verified, right now?**

Local-first **markdown** is the source of truth (works fully offline, no SaaS, no Jira required).
It's **agent-native** (an MCP server so Claude/Copilot can drive it) and **integrates everywhere** —
Jira, Confluence, GitHub/GitLab issues, CI/CD, custom scripts — but those are optional projections you
sync to, never prerequisites.

```
requirements  ⇄  tasks  ⇄  tests  ⇄  results        (one traceable model, in markdown)
      │             │          │
   Confluence     Jira     your test suites           (optional, synced projections)
```

MIT-licensed and free to self-host. New here? See **[VISION.md](VISION.md)** for the full picture and
roadmap.

> **Coding agent or contributor?** Start with **[AGENTS.md](AGENTS.md)**.

---

## Three pillars

| Pillar | What you get |
|---|---|
| **📄 Documentation** | Markdown ⇄ Confluence/Jira, both ways, round-trippable, mermaid preserved. Interactive decision docs (`katastasi questions`). Optional AI-authored technical analysis. |
| **✅ Task tracking** | A local, markdown task model (`.acp/tasks`) linked to requirements and tests, usable standalone **or** imported read-only from Jira. A task marked *done* whose requirements aren't verified is flagged ⚠️ — "is done really done?" at the task level. |
| **🧪 Testing** | Links **and** runs your existing suites (Playwright/Jest/Vitest/node/xUnit), **plus a built-in requirement-first acceptance runner** (`katastasi test` — HTTP + CLI) — all joined to requirements at the git commit → a true, per-requirement status with regression detection. |

## Install

```bash
# Run without installing (recommended)
npx katastasi trace init
npx katastasi --help

# Or install globally
npm i -g katastasi            # also published as @dloizides/katastasi

# Or Docker
docker run --rm -v "$PWD:/work" -w /work ghcr.io/openmindednewby/katastasi trace
```

Binary is **`katastasi`** (short alias **`kat`**; `acp` still works through the transition).

## Quick start — requirements traceability

Answer *"which requirements actually hold true, at this commit?"* by linking your tests to requirements
(a Jira epic, a markdown spec, `roadmap.html`, a Confluence page, or GitHub/GitLab issues) and joining
them with the test **results**.

```bash
katastasi trace init                        # autodetect frameworks + requirements → acp-trace.json
katastasi trace serve                       # web portal: live dashboard + ▶ Run buttons + history
katastasi trace --run --fail-on regression  # CI: re-run suites, trace, fail on any regression
```

Each requirement is classified **✅ verified** / **❌ failing** / **🧪 unverified** / **📋 specified**,
flagged **⚠️ drift** when it's declared *done* but isn't verified, and a requirement going
verified → failing is a **⛔ regression**. Tag tests inline (`test('login works @PROJ-123', …)`,
`[Trait("req","PROJ-123")]`) or list them in a mapping file. Full guide:
**[docs/TRACEABILITY.md](docs/TRACEABILITY.md)** · 5-minute setup: **[docs/ONBOARDING.md](docs/ONBOARDING.md)**.

## Business requirements → development-ready

Gather requirements from a mix of sources, find the gaps against the codebase, capture open decisions as
an interactive form, then turn it all into a technical analysis + tasks + tagged test stubs:

```bash
katastasi trace pull-requirements   # mixed sources (Jira/Confluence/md/issues/script) → local folder
katastasi trace gaps                # which requirements aren't in code / lack tests / aren't verified
katastasi pipeline                  # one command: gather → gaps → analyze → tech doc + tasks + tests
katastasi pipeline --ask            # two-pass: open-questions form first, then --answers
```

`katastasi analyze` (AI) produces a gap analysis, a Confluence-ready technical-analysis page, Jira tasks
(acceptance criteria + use-case flow), and scaffolded tagged unit/e2e test stubs — local and/or
published. Guide: **[docs/TECH_ANALYSIS_FLOW.md](docs/TECH_ANALYSIS_FLOW.md)**.

## Task tracking

Local, markdown-first tasks that link to requirements and tests — and stay honest:

```bash
katastasi task add "Implement login" --req PROJ-1   # → .acp/tasks/TASK-1.md
katastasi task set TASK-1 done
katastasi task board                                # → .acp/BOARD.md (kanban by status)
katastasi task verify --fail-on drift               # ⚠️ a done task whose reqs aren't verified fails CI
```

Statuses are configurable (`tasks.statuses`); IDs are global `TASK-<n>` or per-scope (`WEB-<n>`). Set
`tasks.mode: jira` to import issues read-only (`katastasi task import`). `katastasi analyze` also drops
its generated stories straight onto the board. Agents drive it all via the `task_*` MCP tools. Full
design: **[docs/PHASE-1-DESIGN.md](docs/PHASE-1-DESIGN.md)**.

## Acceptance testing (requirements that verify themselves)

Attach an **executable acceptance test** to a requirement and `katastasi test` runs it — HTTP/REST calls
(or CLI commands) with assertions — then writes JUnit results keyed by requirement, so `trace` flips the
requirement to **✅ verified** on pass (and clears any task drift). Existing Jest/Playwright suites keep
being *linked*, not replaced.

```bash
katastasi test                       # run .acp/tests specs + inline ```acp-test blocks → JUnit
katastasi test --req PROJ-1          # just one requirement
katastasi trace                      # fold the results into per-requirement status
```

Author them three ways — a spec file (`.acp/tests/PROJ-1.acp.json` / `.acp.yml` / a markdown table),
or **inline** under a requirement, terse or JSON:

````markdown
## PROJ-1 — Login
```acp-test
POST /login {"user":"x","pass":"bad"} -> 401
```
````

Steps assert status / JSON-path / header / body-contains, **capture** variables to chain (login → token →
reuse), and read secrets from env via `{{env.NAME}}`. `baseUrl`, default headers, and a one-time login
`setup` live in the config `runner` block. `katastasi analyze` generates these specs straight from the
requirements. Agents drive it via the `test_run` MCP tool. Full guide: **[docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)**.

## Integrations

- **AI agents (MCP):** this repo *is* an MCP server (`katastasi-mcp`). Agents call `requirements_trace`,
  `analyze`, `pull_requirements`, `scaffold_test`, `requirement_status`, `markdown_to_jira`,
  `markdown_to_confluence`, and more. See **[docs/CLI_AND_MCP.md](docs/CLI_AND_MCP.md)** and
  **[docs/AGENT_PROMPT.md](docs/AGENT_PROMPT.md)**.
- **Jira & Confluence (both ways):** `pull-jira` / `pull-confluence` → markdown folders; edit; `push-folder`
  back. Recursive + round-trippable.
- **GitHub / GitLab issues:** as requirement sources (by label/milestone).
- **CI/CD:** a published **GitHub Action** (`uses: openmindednewby/katastasi@v0.2.0`) plus GitLab CI and
  pre-commit templates in **[docs/ci/](docs/ci/)**. Exit non-zero on regression.
- **Custom scripts / services:** a `command` requirement source (run any script → requirements), an
  `output.post` sink (POST the full report to your server), and a self-hosted `collector`.
- **Local-only markdown:** requirements, runs, and reports are plain files you can commit. No external
  service needed for the core.

## AI authoring (optional add-on)

The original flow — describe a feature → AI writes a structured technical analysis → publish to
Confluence + create Jira tickets — is retained as an optional module. It runs via the `claude` / `gh
models` CLIs (no Docker/keys) or via self-hosted **n8n** (browser UI), with a 13-template registry and
team context profiles.

![AI authoring workbench](docs/screenshot.png)

```bash
./scripts/cli-preview.sh "Add user notification preferences"        # Claude Code CLI
./scripts/gh-models-preview.sh "Add user notification preferences"  # GitHub Models (free)
```

Full reference: **[docs/WORKFLOWS.md](docs/WORKFLOWS.md)** · **[docs/CLI_SETUP.md](docs/CLI_SETUP.md)** ·
**[docs/SETUP.md](docs/SETUP.md)** · templates in [templates/](templates/), profiles in
[team-profiles/](team-profiles/).

## Roadmap

Katastasi is built MVP-first — a releasable phase every 1–2 weeks. Full detail in **[VISION.md](VISION.md)**.

- **Phase 0 ✅** — Rebrand & distribution: rename, npm + Docker + GitHub Action (0.2.0).
- **Phase 1 ✅** — unified `.acp/` model + switchable local/Jira/hybrid **task tracking** (shipped 0.3.0).
- **Phase 2 ✅** — requirement-first **acceptance test runner** (HTTP + CLI; shipped 0.4.0). See [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md).
- **Phase 3** *(next)* — **bidirectional sync** (git-backed, incremental and safe).
- **Phase 4 —** breadth (pytest/go/cypress, more CI) & polish.

## Free & paid

Everything in this repo is **MIT and free to self-host** — the entire CLI, MCP server, runner, sync, and
local engine. Paid offerings are only: a **hosted cloud** (managed dashboard/collector), **support**, and
**custom development**.

## Contributing

Contributions welcome — see **[CONTRIBUTING.md](CONTRIBUTING.md)**. Good first steps: a new requirement
source, a test-framework adapter, or a CI template.

## License

MIT — see [LICENSE](LICENSE).
