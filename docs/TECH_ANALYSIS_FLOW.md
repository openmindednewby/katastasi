# Business requirements → development-ready, with verification

The full pipeline: take requirements from a **mix** of sources, find the **gaps** against the codebase,
capture decisions via **interactive forms**, and produce a **technical analysis + Jira tasks + tagged
unit/e2e test stubs** — local and/or published — so an implementation agent knows exactly what to build
and how to verify it.

```
sources (Jira/Confluence/md/issues/script)
   │  acp trace pull-requirements         → requirements/ (one md per req + manifest)
   ▼
gaps (code-side, deterministic)
   │  acp trace gaps                       → 📋 not in code · 🧪 coded-no-test · ❌ unverified
   ▼
decisions (human-in-the-loop)
   │  acp questions open-questions.md      → interactive form (mermaid flow + QA); stakeholders answer
   ▼
technical analysis (AI)
   │  acp analyze                          → gap-analysis.md + technical-analysis.md (Confluence-ready)
   │                                          + tasks/<KEY>.md (AC + use-case flow) + scaffolded @KEY tests
   ▼
publish (optional) + develop + verify
      acp confluence --page …  ·  acp jira --epic …      (or --publish-confluence/--publish-jira)
      acp trace --run --fail-on regression               (the implementation agent's definition of done)
```

## Commands

```bash
# 1. Gather requirements from every configured source into one local folder
acp trace pull-requirements                 # → requirements/PROJ-1.md, GH-12.md, … + manifest.json

# 2. See the implementation gap (tag code with @KEY, add scope.code globs)
acp trace gaps                              # which requirements aren't in code / lack tests / aren't verified

# 3. Capture open decisions as an interactive form (mermaid + QA), share, collect answers
acp questions docs/open-questions.md        # → .html; export answers.md → acp confluence

# 4. AI: gap analysis + technical-analysis page + Jira tasks + tagged test stubs
acp analyze                                 # → tech-analysis/{gap-analysis,technical-analysis}.md + tasks/ + test stubs
acp analyze --publish-confluence --publish-jira   # …and push them to Confluence + Jira

# 5. Implement against the tasks, then verify nothing's faked
acp trace --run --fail-on regression
```

Every artifact is **local first**; publishing to Confluence/Jira is opt-in (`--publish-*`, or the
`markdown_to_confluence` / `markdown_to_jira` MCP tools). `acp analyze` uses the configured AI provider
(`AI_PROVIDER` / `AI_BASE_URL` / `AI_MODEL` + an API key); everything else is deterministic and offline.

## As an agent flow (MCP)

Your local Claude/Copilot can run the whole thing through the MCP tools:

```text
Using the acp MCP tools, take feature [PROJ-200] from requirements to development-ready:
1. pull_requirements   → the local requirements folder.
2. requirements_trace  → the current gaps (what's not in code / not tested).
3. (if decisions are open) draft an open-questions markdown with a mermaid flow + QA, call
   questions_to_html, and share it for stakeholders to answer.
4. analyze             → gap analysis + technical-analysis page + Jira tasks + scaffolded @KEY tests.
5. markdown_to_confluence (technical-analysis.md) + markdown_to_jira (tasks/) to publish.
6. Implement each task; for each, fill the scaffolded test and call requirement_status until verified.
Stop and ask me for any decision that is genuinely mine.
```

See [AGENT_PROMPT.md](AGENT_PROMPT.md) for more flows, and [TRACEABILITY.md](TRACEABILITY.md) for the
requirement sources, `code` globs, and verification.
