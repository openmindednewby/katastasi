# Katastasi — Vision & Roadmap

> **Katastasi** (Greek *κατάστασις*, "status / state") — the real state of every requirement, task,
> and test, kept honest. Sits beside **Erevna** (research) and **Katalogos** (catalog).

*Status of this document: agreed plan, pending execution. Draft 1 — 2026-06-22.*

---

## 1. What Katastasi is

An open-source **documentation + task-tracking + testing framework** that keeps one honest answer to
the question every team fumbles: **"what is the real status — is this actually done, and verified, right
now?"**

It is **local-first markdown** (works fully offline, no SaaS, no Jira), **agent-native** (an MCP server
+ agent-flow prompts so Claude/Copilot can drive it), and **integratable everywhere** (Jira, Confluence,
GitHub/GitLab issues, CI/CD, custom scripts) — but those are *optional projections*, never required.

Three pillars, unified by a single traceable model:

| Pillar | What it does |
|---|---|
| **Documentation** | Markdown ⇄ Confluence/Jira (both ways, round-trippable, mermaid); interactive decision docs; AI-authored technical analysis (optional add-on). |
| **Task tracking** | A native, local, markdown task model (IDs, status, links to requirements/tests/docs) that can run standalone **or** defer to Jira/GitHub. |
| **Testing** | Links + runs your existing suites (Playwright/Jest/Vitest/node/xUnit/…) AND a built-in **requirement-first acceptance runner** — joined to requirements at the git commit to produce a true status. |

## 2. Principles

1. **Local markdown is the source of truth.** Everything lives in a `.acp/` store as markdown + a
   manifest. Jira/Confluence/issues/cloud are *projections* you can sync to — never prerequisites.
2. **Status is the heart.** Every requirement/task/test resolves to a real state at a specific commit:
   verified / failing / unverified / specified / drifted / stale / not-in-code.
3. **Agent-first.** Anything a human can do, an agent can do via MCP. AI *authoring* (analysis, test
   generation) is built-in but always optional and provider-agnostic.
4. **Don't reinvent runners — close the gap they leave.** Keep linking Jest/Playwright/pytest/etc.; the
   native runner only owns what they don't: executable, requirement-attached **acceptance** tests.
5. **Safe and incremental.** Especially for sync: never ship a silent-merge data-loss bug. Ship one-way
   + conflict-flagging first; add auto-merge only when proven.
6. **Easy to adopt.** `npx katastasi`, a Docker image, and a copy-paste CI action — no clone-and-build.

## 3. The unified model

```
.acp/
  requirements/   PROJ-1.md …    (req: title, status, acceptance criteria, links)
  tasks/          TASK-1.md …    (task: status, links to req/tests/docs)
  tests/          PROJ-1.acp.yml (acceptance specs; + inline criteria in requirements)
  runs/           <git-sha>/…    (results, history, regressions)
  manifest.json                  (the graph + sync revisions)
```

One graph — **requirement ↔ task ↔ test ↔ doc ↔ result** — that *projects out* to Jira (tasks),
Confluence (docs), issues, or a server, and *syncs back*.

## 4. Locked design decisions

| Dimension | Decision |
|---|---|
| **Identity** | Rename `ai-confluence-pipeline` → **Katastasi**. README leads with the framework. The n8n AI-publishing flow becomes an optional **"AI authoring"** add-on. |
| **Task tracking** | Switchable per project: `mode: local` (markdown canonical) · `jira` (Jira canonical) · `hybrid` (two-way). |
| **Test runner** | Requirement-first **acceptance runner**; **agent-authored first**; **HTTP/REST first**, then CLI/process, then units, then Playwright/browser (link, don't rebuild). Tests live **both** inline in the requirement md and in separate spec files, tagged by key. |
| **Sync** | **Hybrid**: git detects local changes, a manifest tracks remote revisions, field-aware. Built incrementally: **v1** one-way + conflict-flag → **v2** field-level auto-merge → **v3** interactive 3-way. |
| **Distribution** | **npm** (`katastasi` + `@dloizides/katastasi`, both → same tool) · **public Docker image** (GHCR) · **published GitHub Action + GitLab/pre-commit templates**. Binary `katastasi` (+ short alias `kat`; `acp` kept through transition). |
| **OSS / paid** | Everything is **free and self-hostable** (MIT). You pay only for: **(a)** the hosted cloud (dashboard/collector, multi-tenant), **(b)** support, **(c)** custom development. |
| **First users** | Dogfood on the SaaS monorepo + the company you work at (real Jira/Confluence/CI). |
| **Cadence** | ~10+ hrs/week; a releasable phase every 1–2 weeks; small PRs. |

## 5. Roadmap

Each phase is a release. MVP-first: publish what exists, then build runner → sync.

### Phase 0 — Rebrand & distribution *(the "easily integratable" unlock)*
Rename to Katastasi; README re-led around docs·tasks·tests; n8n demoted to optional. Publish to npm
(`katastasi` + `@dloizides/katastasi`), push the Docker image to GHCR, ship a published GitHub Action +
GitLab/pre-commit templates, add semver + `CHANGELOG.md` + this `VISION.md`.
**Done when:** `npx katastasi trace` works for a stranger; `docker run` works; CI integration is copy-paste.

### Phase 1 — Unified `.acp/` model + switchable task tracking ✅ *(shipped 0.3.0)*
Define the `.acp/` canonical store (tidy hidden folder, back-compatible) and the req↔task↔test graph.
Add native `katastasi task` commands + a markdown board + MCP tools, with a configurable status set and a
**honesty cross-check** (a task marked *done* whose requirements aren't verified is flagged ⚠️). `mode:
local` is full; `mode: jira` imports read-only; `hybrid` lands in Phase 3. **Full design:
[docs/PHASE-1-DESIGN.md](docs/PHASE-1-DESIGN.md).**
**Done when:** a team can track tasks entirely in local markdown (or read-only from Jira) and the drift
flag fires when "done" isn't proven.

### Phase 2 — Acceptance test runner (HTTP first)
`katastasi test` executes acceptance criteria (HTTP/REST: call → assert status/body/headers), inline +
spec files, results auto-feeding `trace`. `analyze` generates them; `trace` verifies them.
**Done when:** an AI-generated requirement ships with an executable criterion that flips it to ✅ on pass.
*Then extend:* CLI/process targets → link units (Jest/pytest/xUnit) → link Playwright.

### Phase 3 — Bidirectional sync (incremental)
Hybrid engine across Jira + Confluence + GitHub/GitLab issues. **v1** one-way + conflict-flag, **v2**
field-merge, **v3** interactive 3-way.
**Done when:** editing either side reconciles safely, with conflicts surfaced — never silently lost.

### Phase 4 — Breadth & polish
More frameworks/result formats (pytest, go test, surefire, cypress), more CI providers, a docs site,
flaky-test detection, richer examples.

## 6. Non-goals (to keep scope honest)

- **Not a replacement** for Jest/Playwright/pytest — we link and run them; the native runner only adds
  the requirement-attached acceptance layer.
- **Not a hosted-only product** — the OSS core is fully usable offline; cloud is an optional paid tier.
- **No silent merges** — sync favours surfacing conflicts over guessing.
- **Not locked to Jira/Confluence** — they're first-class sinks, but issues/markdown/your-own-server are
  equally supported.

## 7. Where we are today (honest baseline)

Already shipped and tested (~144 tests): the `acp` CLI + `acp-mcp` MCP server; markdown ⇄ Jira/Confluence
(both ways); `acp trace` (RTM: links tests↔requirements↔results at the git commit, regression/stale/
code-gap detection, run history, a secured portal with run triggers, autodetect onboarding); `acp
analyze` (AI gap analysis → tech doc + Jira tasks + scaffolded tagged tests, with a clarify→answer loop);
`acp pipeline` (one-command BA→dev flow); company-agnostic sources (Jira/Confluence/GitHub/GitLab/
markdown/command) and sinks (files/post/collector).

Maturity vs. the vision: Documentation ~80% · Testing (as orchestration) ~75% · AI-agent ~80% ·
Confluence/Jira ~85/80% · **Task tracking ~35%** · **Distribution ~40%** · Local-only-markdown ~55%.
Phases 0–3 target exactly those gaps.
