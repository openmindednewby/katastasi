# Phase 2 — Requirement-first acceptance test runner (HTTP-first)

*Scope drafted 2026-06-22. The third pillar: requirements that verify **themselves**. Implements the
test-runner decision from [VISION.md](../VISION.md). **Open questions in §6 are resolved at build-start.***

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
| First target | **HTTP/REST** — then CLI/process, then *link* units/Playwright (don't rebuild) |
| Location | **Both** inline in the requirement md **and** separate spec files, tagged by key |

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

## 4. Build plan (proposed, ordered, each tested)
1. **Spec format + parser** — inline ` ```acp-test ` block + `.acp.json` files → an `AcceptanceCase[]` model.
2. **HTTP executor** — `fetch`-based (Node ≥20 global fetch; **no new dep**) request + `{{var}}` interpolation.
3. **Assertions** — status, JSON-path (hand-rolled `$.a.b`/`exists`), headers, body-contains; + `capture`.
4. **Runner** — gather specs → run cases → structured results.
5. **JUnit emission + `acceptance` tech** — write keyed JUnit XML; wire into the trace config + ingestion.
6. **CLI `katastasi test` + MCP `test_run`**.
7. **`analyze` emits executable criteria** (extend the generation format).
8. Tests per step (unit; HTTP executor tested against an in-process `http` server — no network).

## 5. Out of scope (later)
CLI/process target + browser/unit (those *link* existing runners) → **Phase 2.2**. Full auth/OAuth flows,
parallelism, load testing, and a spec GUI → later. Two-way sync stays **Phase 3**.

## 6. Open questions to resolve at build-start (ask the owner first)
1. **Spec file format** — JSON (no dep, per the no-YAML-dep house style) vs a hand-rolled YAML-lite vs
   markdown-table cases? (Proposed: JSON files + the inline ` ```acp-test ` block.)
2. **Inline DSL** — a terse line form (`POST /login {..} -> 401`) vs the same JSON in the fenced block?
3. **Result bridge** — emit JUnit XML and reuse trace ingestion (proposed) vs a native acceptance-result
   path into the report?
4. **Assertions vocabulary** — which to ship first: status, json-path `exists`/equals, header, body-contains,
   response-time? JSON-path: hand-rolled minimal vs a tiny lib?
5. **Base URL / auth / env** — a `runner` config block + a reusable `setup`/login step + `{{var}}`
   interpolation from env? How are secrets supplied (env vars)?
6. **Chaining/capture** — confirm step-to-step variable capture is in v1 (needed for realistic API tests).
7. **HTTP client** — confirm built-in `fetch` (no dependency).
8. **Phasing** — ship HTTP-only as **2.1**, defer CLI/process to **2.2**?
