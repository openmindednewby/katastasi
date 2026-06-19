# Requirements Traceability (RTM)

Link your tests to your requirements and know — **at a specific git commit** — which requirements
actually hold true. `acp trace` pulls a requirement list, scans your test sources for the keys they
cover, ingests the test results, and emits a living report (markdown + HTML) you can commit, fold into
an existing doc, or publish to Confluence / Jira.

```
requirements (Jira / roadmap / Confluence / markdown) ─┐
test sources  (what claims to cover each key)          ├─►  join @ git commit  ─►  report
test results  (JUnit / TRX — does it pass?)            ─┘
```

## The join key

Everything keys off a stable **requirement key** — by default a Jira issue key (`PROJ-123`). Override
the pattern with `keyPattern` in the config (any regex, e.g. `REQ-\d+` or `#\d+`).

## States

| State | Meaning |
|-------|---------|
| ✅ **verified** | a test references it **and** every referencing test that ran passed |
| ❌ **failing** | referencing tests exist and at least one failed |
| 🧪 **unverified** | referenced by a test, but no result was ingested (not run / skipped-only) |
| 📋 **specified** | the requirement exists but **no** test references it |
| ⚠️ **drift** | declared *done* in the source, but not verified — *"done" may not be true* |
| 👻 **orphan test** | a test tags a key that has no matching requirement |

## Quick start

```bash
acp trace init --project "My Product"        # autodetects your test frameworks + a requirements source
acp trace serve                              # open the portal: live dashboard + a Run button
# …or headless:
acp trace --config acp-trace.json --run      # (re)run the suites, trace, save a run, flag regressions
```

`acp trace init` scans the repo (Playwright/Jest/Vitest/node:test/xUnit), guesses each suite's run
command + result paths, finds a requirements source (or creates `docs/requirements.md`), and writes a
ready `acp-trace.json`. Override with `--jira-epic`, `--markdown`, `--roadmap`, `--confluence-page`, or
`--template` for a plain template.

## Linking tests to requirements (hybrid)

You can use either or both:

**1. Inline tags** — local to the test, survive refactors:

```ts
// Playwright / Jest / Vitest / node:test
test('user can log in @PROJ-123', async () => { /* … */ });
it('logs out', () => { /* @req PROJ-124 */ });
```

```csharp
// xUnit
[Fact]
[Trait("req", "PROJ-125")]
public void Token_is_revoked_on_logout() { /* … */ }
```

Recognised forms: `@PROJ-123`, `@req PROJ-123`, `@covers PROJ-123`, and `[Trait("req","PROJ-123")]`.

**2. A mapping file** — zero test changes, central (drifts over time, so prefer tags long-term):

```yaml
# traceability.yml
PROJ-123:
  - e2e/login.spec.ts
  - src/auth/login.test.ts
PROJ-125: Services/Auth.Tests/TokenTests.cs
```

(JSON works too: `{ "PROJ-123": ["e2e/login.spec.ts"] }`.)

## Test results

Point `results` at the JUnit XML / TRX your runners already emit. Keys are read from each test's
name/classname (so an inline `@KEY` flows straight through). Examples:

- **Playwright** — `reporter: [['junit', { outputFile: 'e2e/results/junit.xml' }]]`
- **Jest** — `jest-junit` → `coverage/junit.xml`
- **Vitest** — `--reporter=junit --outputFile=results/junit.xml`
- **dotnet** — `dotnet test --logger "trx;LogFileName=results.trx"`

Without results a referenced requirement is **🧪 unverified**; with a passing result it becomes
**✅ verified**.

## Config — `acp-trace.json`

```jsonc
{
  "project": "My Product",
  "keyPattern": "[A-Z][A-Z0-9]+-\\d+",   // optional; default = Jira keys
  "repoDir": ".",                          // globs + git resolve against this (relative to the config)
  "scopes": [
    {
      "name": "auth",
      "requirements": [
        { "type": "jira-epic", "epic": "PROJ-100", "recursive": true },
        { "type": "roadmap-html", "path": "docs/roadmap.html" },
        { "type": "confluence-page", "pageId": "123456" },
        { "type": "markdown", "path": "docs/requirements.md" }
      ],
      "tests": [
        { "tech": "playwright", "globs": ["e2e/**/*.spec.ts"], "command": "npx playwright test", "results": ["e2e/results/*.xml"] },
        { "tech": "jest", "globs": ["src/**/*.test.ts"], "command": "npx jest", "results": ["coverage/junit.xml"] },
        { "tech": "xunit", "globs": ["Services/**/*Tests.cs"], "command": "dotnet test --logger trx", "results": ["Services/**/TestResults/*.trx"] }
      ],
      "mapping": "docs/traceability.yml"
    }
  ],
  "history": { "dir": "runs" },
  "portal": { "port": 8787 },
  "output": { "markdown": "docs/RTM.md", "html": "docs/rtm.html", "json": "docs/rtm.json" },
  "publish": {
    "roadmap": { "path": "docs/roadmap.md", "sectionId": "rtm" },
    "confluence": { "pageId": "67890", "title": "Requirements Verification" }
  }
}
```

**Scopes** let one config span many epics / products / orgs — each scope picks its own requirement
source(s). Requirements from all scopes are merged by key. Use `name` to label where each came from.

### Requirement sources

| `type` | Needs | Notes |
|--------|-------|-------|
| `jira-epic` | `JIRA_*` creds in `.env` | epic's children are the requirements; `recursive` adds sub-tasks; `includeEpic` adds the epic; `doneStatuses` overrides which statuses count as done |
| `roadmap-html` | a local HTML file | best with `data-req="KEY" data-title="…" data-status="…" data-complete="true"` attributes; falls back to parsing visible text |
| `confluence-page` | `CONFLUENCE_*` creds | page body is converted to markdown and parsed (write the spec as a table or checklist) |
| `markdown` | a local file | a table (`\| KEY \| Title \| Status \|`) or a checklist (`- [x] KEY Title`) |

## Outputs & publishing

- `output.markdown` / `.html` / `.json` — written every run. The **HTML** is a self-contained,
  filterable dashboard (open it, commit it, or serve it).
- `publish.roadmap` — folds the report into an existing markdown doc **between markers**
  (`<!-- acp:trace:start rtm -->…<!-- acp:trace:end rtm -->`), idempotently, leaving the rest untouched.
  Override per-run with `--roadmap <path> --section <id>`.
- `publish.confluence` — `acp trace --publish-confluence` updates that Confluence page in place
  (markdown → storage format, version bumped).

## Re-run on demand, history & regressions

Give a test group a `command` and `acp trace --run` will **execute it** (regenerating its JUnit/TRX)
before tracing — so a run reflects the code as it is *right now*. Without `--run`, the tool just
ingests whatever result files already exist (e.g. from CI).

When `history` is configured, every run is saved as a **git-stamped JSON snapshot** in `runs/`, and the
current run is **diffed against the previous one** (or a named `history.baseline`). Requirements whose
state got worse — e.g. `verified → failing` — are reported as **⛔ regressions** (and the inverse as
improvements). That's your regression check across commits.

```bash
acp trace --run                       # run suites → trace → save snapshot → diff vs last run
acp trace --no-save                   # trace without recording history
acp trace --no-compare                # skip the diff
```

## The portal (`acp trace serve`)

A built-in, dependency-free web portal — live dashboard + a **Run** button + run history + the
regression banner — and a small HTTP API so anything can trigger a run.

```bash
acp trace serve --config acp-trace.json --port 8787   # http://127.0.0.1:8787
```

| Route | Purpose |
|-------|---------|
| `GET /` | the live dashboard (Run button, history, regression banner) |
| `GET /api/report` | the current report as JSON |
| `GET /api/runs` | recent run snapshot filenames |
| `POST /run` | trigger a run. `?run=1` executes the suites; `?publish=1` also updates the Confluence page. Writes the configured outputs + roadmap section. |

## Trigger it from anywhere

Same engine, four front doors — all honour the same config:

- **Portal** — the Run button (`POST /run`).
- **CLI / CI** — `acp trace --run --fail-on regression` as a pipeline step.
- **Agent (MCP)** — the `requirements_trace` tool with `run: true`.
- **n8n / any webhook** — call the portal: `curl -X POST http://host:8787/run?run=1` (an n8n HTTP
  Request node pointed at `/run` turns a schedule or webhook into a regression run).

Each run can also refresh where humans/agents look: it writes `output.*`, folds the roadmap section,
and (with `?publish=1` / `--publish-confluence`) updates the Confluence page — so Jira/Confluence/local
md all stay current automatically.

## CI gate

```bash
acp trace --config acp-trace.json --fail-on failing      # exit 1 if any requirement is failing
acp trace --config acp-trace.json --fail-on drift        # exit 1 if anything is failing OR drifting
acp trace --config acp-trace.json --run --fail-on regression  # run suites; exit 1 on any regression
```

Run it after your test suites (so the result files exist), commit `docs/RTM.md`, and the diff shows
exactly which requirements changed state at that commit.

## MCP

Agents can call **`requirements_trace`** (`{ configPath?, format?, run? }`) to get the markdown report +
structured stats (incl. regressions) for the current commit, optionally re-running the suites first.
See [CLI_AND_MCP.md](CLI_AND_MCP.md).

## How it works (internals)

`src/core/trace/` — `requirements/*` providers → `runner` (optional suite execution) → `testScanner`
(tags + mapping) + `results` (JUnit/TRX) → `computeState` (the join) → `history` (save + regression
diff) → `report/markdown` + `report/html` → `publish` (files / section / Confluence) → `serve` (portal).
`autodetect` powers `trace init`; `gitContext` stamps the commit. Everything except the live
Jira/Confluence fetch is pure and unit-tested offline (`test/trace*.test.js`).
