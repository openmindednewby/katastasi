# Acceptance testing (`katastasi test`)

> Phase 2. A **requirement-first** acceptance runner: attach an executable test to a requirement, run it
> with `katastasi test`, and `trace` flips that requirement to **✅ verified** when it passes. HTTP/REST
> and CLI/process targets. Your existing Jest/Playwright/pytest suites keep being *linked*, not replaced —
> this only adds the executable, requirement-attached layer they don't cover.

## The loop

```
analyze  →  .acp/tests/PROJ-1.acp.json   (executable acceptance spec, AI- or hand-authored)
test     →  run the cases  →  .acp/results/acceptance.xml   (JUnit keyed by requirement)
trace    →  ingest the JUnit  →  PROJ-1 = ✅ verified   (and any task linked to it stops drifting)
```

## Where tests live (author any of these)

A test belongs to one **requirement key** and has named **cases**; each case is an ordered list of
**steps**. Three file formats + an inline form, all parsing into the same model.

### 1. JSON spec file — `.acp/tests/<KEY>.acp.json`
```json
{ "req": "PROJ-1", "cases": [
  { "name": "rejects bad credentials",
    "steps": [ { "POST": "/login", "body": {"user":"x","pass":"bad"}, "expect": { "status": 401 } } ] },
  { "name": "returns a token then reads me",
    "steps": [
      { "POST": "/login", "body": {"user":"a","pass":"b"}, "expect": { "status": 200 }, "capture": { "tok": "$.token" } },
      { "GET": "/me", "headers": { "Authorization": "Bearer {{tok}}" }, "expect": { "status": 200, "json": { "$.id": "exists" } } }
    ] } ] }
```

### 2. YAML-lite spec file — `.acp/tests/<KEY>.acp.yml`
```yaml
req: PROJ-1
cases:
  - name: returns a token then reads me
    steps:
      - POST: /login
        body: { user: a, pass: b }
        expect: { status: 200 }
        capture: { tok: $.token }
      - GET: /me
        headers: { Authorization: "Bearer {{tok}}" }
        expect: { status: 200, json: { $.id: exists } }
```

### 3. Markdown-table spec file — `.acp/tests/<KEY>.acp.md`
Best for simple, single-step checks (readable in a PR). Columns (any case): `name`, `req`, `method`,
`path`, `body`, `status`, `contains`, `run`, `exit`. The key comes from a `req` column or a leading
`req: KEY` line.
```markdown
req: PROJ-1
| name        | method | path    | status |
|-------------|--------|---------|--------|
| bad creds   | POST   | /login  | 401    |
| health ok   | GET    | /health | 200    |
```

### 4. Inline in a requirement — ` ```acp-test ` block
Author the test **under** the requirement it verifies (the block inherits the nearest preceding
requirement key, e.g. a `## PROJ-1 …` heading). Two forms in the same block:

````markdown
## PROJ-1 — Login

```acp-test
POST /login {"user":"x","pass":"bad"} -> 401
GET /health -> 200 contains "ok"
```
````
…or the full JSON for chained/captured cases:
````markdown
```acp-test
{ "cases": [ { "name": "login then me", "steps": [
  { "POST": "/login", "expect": { "status": 200 }, "capture": { "tok": "$.token" } },
  { "GET": "/me", "headers": { "Authorization": "Bearer {{tok}}" }, "expect": { "status": 200 } }
] } ] }
```
````
Terse grammar: `METHOD /path [jsonBody] -> STATUS [contains "x"]` or `run <command> -> <exit> [contains "x"]`.

## Steps

| Step | Shape | Asserts |
|------|-------|---------|
| **HTTP** | `{ "GET": "/path", body?, headers?, expect, capture? }` (any method key) | `status`, `json`, `headers`, `bodyContains` |
| **CLI/process** | `{ "run": "node cli.js --help", cwd?, expect, capture? }` | `exit`, `bodyContains` (stdout+stderr) |

### Assertions (`expect`)
- `status` — HTTP status code · `exit` — process exit code
- `json` — a map of **JSON-path → matcher**: `"$.a.b[0].id": "exists"` / `"absent"` / a literal to equal
- `headers` — header name (case-insensitive) → exact value
- `bodyContains` — substring(s) the body / stdout must contain

### Capture (chaining)
`capture` writes variables read by later steps via `{{name}}`:
- HTTP: `"status"`, `"header:Name"`, or a `$.json.path`
- process: `"stdout"`, `"stderr"`, `"exit"`

Each **case** gets its own variable bag, seeded from the one-time `setup` (below).

## Config — the `runner` block

In `acp-trace.json`:
```jsonc
{
  "scopes": [ {
    "requirements": [ { "type": "markdown", "path": "docs/requirements.md" } ],
    "tests": [ { "tech": "acceptance",
                 "globs": [".acp/tests/**/*.acp.json", ".acp/tests/**/*.acp.yml"],
                 "results": [".acp/results/acceptance.xml"] } ]
  } ],
  "runner": {
    "baseUrl": "http://localhost:8080",        // prepended to relative step URLs
    "headers": { "X-Env": "test" },            // default headers on every HTTP step
    "setup": {                                  // one-time; captured vars seed every case
      "name": "login",
      "steps": [ { "POST": "/login", "body": {"user":"a","pass":"{{env.TEST_PASS}}"},
                   "expect": { "status": 200 }, "capture": { "tok": "$.token" } } ]
    }
  }
}
```
If you declare no `tech: "acceptance"` globs, the runner defaults to `.acp/tests/**/*.acp.{json,yml,yaml,md}`
and writes results to `.acp/results/acceptance.xml`.

### Secrets
Secrets never live in specs or config — supply them as **environment variables** and reference them with
`{{env.NAME}}` (e.g. `Authorization: "Bearer {{env.API_TOKEN}}"`).

## CLI

```bash
katastasi test                          # gather specs + inline blocks, run, write JUnit
katastasi test --req PROJ-1             # only this requirement
katastasi test --base-url http://stg    # override runner.baseUrl
katastasi test --specs "api/**/*.acp.json"   # override the spec globs
katastasi test --out results/acc.xml    # JUnit output path
katastasi test --fail-on none           # don't exit non-zero on failures (default: fail)
katastasi trace                         # fold results into per-requirement status
```

## MCP

`test_run` — `{ configPath?, req?, baseUrl?, out? }` → runs the acceptance tests and returns per-case
pass/fail + the results path. Then call `requirements_trace` to update requirement status.

## Generating tests with `analyze`

`katastasi analyze` asks the model for an `acceptanceTests` array on each task (where the requirement is
HTTP/CLI-verifiable) and writes it to `.acp/tests/<KEY>.acp.json` **and** embeds it inline in the story
markdown. So an AI-generated requirement ships development-ready *and* self-verifying:
```bash
katastasi analyze        # → .acp/tests/PROJ-1.acp.json (+ inline ```acp-test in tasks/PROJ-1.md)
katastasi test           # run them
katastasi trace          # PROJ-1 → ✅ verified on pass
```

## Notes & scope

- Built on Node's global `fetch` and `child_process` — **no new dependencies**.
- A case **stops at its first failing step**; a failing `setup` fails all cases.
- Results are plain JUnit, so they also work with any other JUnit consumer.
- **Out of scope (Phase 2.2):** *linking* existing unit (Jest/pytest/xUnit) and Playwright/browser
  suites (those you keep running directly and tag with `@KEY`); OAuth flows, parallelism, load testing.
