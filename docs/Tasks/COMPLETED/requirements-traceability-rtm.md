# Requirements Traceability Matrix (RTM) — link tests ↔ requirements ↔ status

## Goal
Connect E2E + unit tests (across Playwright / Jest / Vitest / node:test / xUnit) to requirements
(Jira epics, roadmap.html, Confluence spec pages, or a markdown spec) so we can answer, **at a
specific git commit**, *which requirements actually hold true* — and emit a living report
(markdown + HTML) that can optionally be published to Confluence / roadmap / Jira via the existing
`acp` pipeline.

## Decisions (from the user)
- **Scope**: generic `acp trace` feature of ai-confluence-pipeline (tech-agnostic, config-driven). Works across orgs.
- **Requirement source**: pluggable + selectable per scope/epic — Jira epics, roadmap.html, Confluence page, markdown. Setup wizard (`acp trace init`).
- **Linking**: hybrid — inline tags (`@KEY` in titles, `[Trait("req","KEY")]` in xUnit) **and** an external mapping file.
- **Version-pinned**: every report stamped with git SHA + branch + dirty + timestamp.
- **Sinks**: configurable — canonical output is markdown + live HTML; publishing (Confluence page / roadmap section / committed RTM.md / Jira labels) is a separate step. Support **in-place section replacement** in existing docs via marker comments.

## Architecture (`src/core/trace/`)
- `types.ts` — Requirement, TestRef, TestResult, TraceConfig, TracedRequirement, TraceReport, state union.
- `gitContext.ts` — current SHA / branch / dirty / commit time (configurable repoDir).
- `testScanner.ts` — static scan of test sources across techs → key→TestRef[] (title tags, comment tags, xUnit Traits) + external mapping file (hybrid).
- `results/junit.ts`, `results/trx.ts` — parse JUnit XML (Playwright/Jest/Vitest) + dotnet TRX → key→status.
- `requirements/` — providers: `markdown.ts`, `roadmapHtml.ts`, `jiraEpic.ts` (reuse atlassian.ts), `confluencePage.ts` (getPage + storageToMarkdown).
- `computeState.ts` — join requirements + refs + results → state (verified / failing / unverified / specified) + drift flag + orphan tests.
- `report/markdown.ts`, `report/html.ts`, `report/json.ts` — canonical outputs.
- `sectionUpdater.ts` — idempotent `<!-- acp:trace:start id -->…<!-- acp:trace:end -->` section replacement.
- `config.ts` — load + validate `acp-trace.json` (zod), normalize scopes.
- `index.ts` — `runTrace(config)` orchestrator.

## Surfaces
- CLI: `acp trace [--config acp-trace.json]`, `acp trace init` (wizard).
- MCP: `requirements_trace` tool.

## State model
| State | Meaning |
|-------|---------|
| ✅ verified | tests reference it AND all referencing tests pass |
| ❌ failing | referencing tests exist but some fail |
| 🧪 unverified | tests reference it but no results ingested (not run) |
| 📋 specified | requirement exists, zero tests reference it |
| ⚠️ drift | declared Done/complete but not verified (the money signal) |
| 👻 orphan-test | a test tags a key with no matching requirement |

## Batches
1. ✅ Offline engine: types, git, scanner, junit/trx, computeState, reports, sectionUpdater (+ tests).
2. ✅ Requirement providers + config + orchestrator (+ tests).
3. ✅ CLI (`trace` + `trace init`) + MCP tool (`requirements_trace`) + publish sinks + docs.

## Status: COMPLETE
- 71/71 tests pass (`npm test`), `npm run typecheck` clean.
- CLI smoke-tested end-to-end: markdown spec + scanned Playwright test + JUnit results →
  PROJ-1 verified, PROJ-2 drift (declared done, no test), PROJ-3 failing, PROJ-404 orphan,
  coverage 33%, `--fail-on drift` exits 1. markdown + HTML + JSON written.
- New files under `src/core/trace/` (types, git, glob, testScanner, results, computeState,
  sectionUpdater, config, publish, index, `requirements/*`, `report/*`); CLI + MCP wired;
  tests `test/trace*.test.js`; docs `docs/TRACEABILITY.md` + README + CLI_AND_MCP.

## Follow-ups (not in scope this pass)
- Live Atlassian round-trip (no creds available here — Jira/Confluence fetch paths reuse the
  already mock-tested REST client but weren't exercised against a real instance).
- Jira label stamping of verified issues (schema field `publish.jira.verifiedLabel` reserved).
- HTML dashboard visual QA in Chrome (extension not connected in this environment).
- Optional: a `trace` watch / serve mode for the live HTML.

## Verification
`npm test` (build + node --test). All pure/local pieces fixture-tested offline; Jira/Confluence providers reuse the mock-tested REST client.
