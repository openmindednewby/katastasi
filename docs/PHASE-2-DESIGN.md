# Phase 2 — Requirement-first acceptance test runner (HTTP + CLI)

> **✅ SHIPPED in 0.4.0 (2026-06-22).** Built broad per the owner's build-start decisions (§2.5): all
> spec formats, both inline forms, all four assertions, HTTP **and** CLI/process in v1. User-facing
> reference: **[ACCEPTANCE.md](ACCEPTANCE.md)**. This doc is kept as the design record.

*Scope drafted 2026-06-22. The third pillar: requirements that verify **themselves**. Implements the
test-runner decision from [VISION.md](../VISION.md).*

## 1. Goal

Executable **acceptance criteria attached to requirements**. `katastasi test` runs them and the results
flow into `trace`, so a requirement flips to ✅ verified the moment its acceptance test passes — and a
task linked to it stops drifting. `analyze` generates these criteria; the loop closes.

**Done when:** an AI-generated requirement ships with an executable HTTP acceptance test that, when it
passes, marks the requirement `verified` in `trace` (and clears task drift) with no hand-written unit
test — while existing Jest/Playwright suites keep being *linked*, not replaced.

## 2. Locked decisions (from the Phase-1 scoping conversation)

| Dimension | Decision |
|---|---|
| Shape | **Requirement-first acceptance runner** — complements (doesn't replace) existing runners |
| Authors | **AI-agent-first** — `analyze` generates them; a human/agent can hand-write too |
| First target | **HTTP/REST + CLI/process** in v1 (resolved 2026-06-22); then *link* units/Playwright (don't rebuild) |
| Location | **Both** inline in the requirement md **and** separate spec files, tagged by key |

## 2.5 Resolved at build-start (2026-06-22)

The owner chose the broad, fully-capable surface. Open questions in §6 resolved as:

| Q | Decision |
|---|---|
| 1 Spec file format | **Support all three** — `.acp.json` (JSON), `.acp.yml` (hand-rolled YAML-lite), and markdown-table cases — all parsing into one `AcceptanceSpec` model. |
| 2 Inline DSL | **Both** — a terse one-liner (`POST /login {..} -> 401`) **and** the full JSON in the same ` ```acp-test ` fenced block. |
| 3 Result bridge | Emit **JUnit XML keyed by requirement** + reuse `trace` ingestion (new `acceptance` tech). |
| 4 Assertions (v1) | **All four** — HTTP status, JSON-path `exists`/equals, response header, body-contains substring. |
| 5 Base URL / auth / env | A `runner` config block (`baseUrl`, `headers`, optional `setup`/login step) + `{{var}}` interpolation; **secrets from env vars only** (`{{env.NAME}}`), never stored in specs. |
| 6 Capture / chaining | **In v1** — step-to-step variable capture (e.g. login → token → reuse). |
| 7 HTTP client | Built-in **`fetch`** (no new dependency). |
| 8 Phasing | **HTTP + CLI/process both in v1 (2.1).** Linking units/Playwright stays 2.2. |

## 3. Proposed design (for discussion at build-start)

### Where tests live
- **Inline** in a requirement markdown: a fenced ` ```acp-test ` block under an `## Acceptance` heading.
- **Spec files**: `.acp/tests/<KEY>.acp.json` (one or many cases per requirement key).
- Both are tagged by requirement key, so the existing `@KEY` join works unchanged.

### Test/case model (HTTP-first)
A case is a named sequence of **steps**; each step is a request + expectations, with optional variable
**capture** for chaining (e.g. grab a token from login, use it in later steps):

```jsonc
{ "req": "PROJ-1", "cases": [
  { "name": "rejects bad credentials",
    "steps": [ { "POST": "/login", "body": {"user":"x","pass":"bad"}, "expect": { "status": 401 } } ] },
  { "name": "returns a token then reads me",
    "steps": [
      { "POST": "/login", "body": {"user":"a","pass":"b"}, "expect": { "status": 200 }, "capture": { "tok": "$.token" } },
      { "GET": "/me", "headers": { "Authorization": "Bearer {{tok}}" }, "expect": { "status": 200, "json": { "$.id": "exists" } } }
    ] } ] }
```

### How results reach `trace` (reuse, don't reinvent)
The runner emits **JUnit XML keyed by requirement** into a results dir; `trace` already ingests JUnit →
the requirement's state is computed by the existing pipeline. A new test tech **`acceptance`** is added to
the trace config so a scope can declare its acceptance specs + results.

### Config (`acp-trace.json`)
```jsonc
{ "tests": [ { "tech": "acceptance", "specs": [".acp/tests/**/*.acp.json"], "results": [".acp/results/acceptance.xml"] } ],
  "runner": { "baseUrl": "http://localhost:8080", "headers": {}, "setup": { /* optional login step */ } } }
```

### Surfaces
- **CLI** `katastasi test [--req KEY] [--base-url …]` → runs specs, writes results, prints pass/fail.
- **MCP** `test_run` (+ the runner feeds `requirements_trace`).
- **`analyze`** emits executable `acp-test` blocks / spec files instead of prose-only criteria.

## 4. Build plan (resolved, ordered, each tested — broad scope)
1. **Model + JSON parser** — `AcceptanceSpec`/`Case`/`Step`/`Expect` model + `.acp.json` spec-file parser.
2. **YAML-lite + markdown-table parsers** — two more spec-file front-ends → the same model; dispatch by ext/content.
3. **Inline parsers** — ` ```acp-test ` fenced blocks in requirement md: terse one-liner **and** JSON fallback.
4. **Interpolation + assertions** — `{{var}}`/`{{env.X}}` interpolation; status, JSON-path (hand-rolled `$.a.b` `exists`/equals), header, body-contains.
5. **HTTP executor** — `fetch`-based step request + `capture` + optional `setup`/login; tested against an in-process `http` server (no network).
6. **Process executor** — CLI/process target (spawn → exit code / stdout asserts + capture).
7. **Runner** — gather every spec source for a scope → run cases → structured `AcceptanceResult`.
8. **JUnit emission + `acceptance` tech + `runner` config** — write keyed JUnit XML; extend the trace config schema; reuse ingestion.
9. **CLI `katastasi test` + MCP `test_run`**.
10. **`analyze` emits executable criteria** (inline `acp-test` blocks + spec files).
11. **Docs pass + 0.4.0 release** (README/VISION/CLI_AND_MCP + `npm run publish:both`).

Each step: small focused files, a `test/*.test.js` added, `npm run typecheck` clean + `npm test` green, one commit.

## 5. Out of scope (later)
CLI/process target + browser/unit (those *link* existing runners) → **Phase 2.2**. Full auth/OAuth flows,
parallelism, load testing, and a spec GUI → later. Two-way sync stays **Phase 3**.

## 6. Open questions — RESOLVED 2026-06-22

All eight were answered by the owner at build-start; see **§2.5** for the decisions. Summary: support
**all** spec formats (JSON + YAML-lite + markdown-table) and **both** inline forms (terse + JSON), ship
**all four** assertions, do step-to-step **capture/chaining** with built-in **`fetch`**, bridge results
via **keyed JUnit → trace ingestion**, supply secrets from **env vars only**, and include **both HTTP
and CLI/process** targets in v1 (2.1).
