# Use acp with your AI agent (Claude / Copilot)

`acp` ships an **MCP server**, so a local agent (Claude Code/Desktop, GitHub Copilot) can drive the whole
service. Register it once, then paste a flow prompt below.

## Connect

```jsonc
// .mcp.json  (Claude Code) — or your Copilot MCP config
{ "mcpServers": { "acp": { "command": "acp-mcp" } } }
// containerised alternative:
// { "mcpServers": { "acp": { "command": "docker", "args": ["run","-i","--rm","--env-file","/abs/.env","acp:latest"] } } }
```

Atlassian tools need `JIRA_*` / `CONFLUENCE_*` in `.env`; traceability/test tools work with no creds.

## The tools your agent gets

| Tool | Use |
|------|-----|
| `jira_to_markdown` / `confluence_to_markdown` | pull a ticket / page into markdown context |
| `markdown_to_jira` / `markdown_to_confluence` / `push_folder` | publish docs, create epics/stories, sync back |
| `questions_to_html` | turn open questions (a mermaid flow + checklist) into an interactive decision page |
| `scaffold_test` | create a key-tagged test stub in the right place |
| `requirements_trace` | the full matrix — which requirements are verified / failing / drifted, + regressions |
| `requirement_status` | the quick "is PROJ-123 verified?" check |

---

## Flow 1 — Implement a ticket, with a machine-checkable "done"

```text
You have the acp MCP tools. Implement Jira ticket [PROJ-123].

1. Pull it: call jira_to_markdown for [PROJ-123] so you have the summary + acceptance criteria.
2. Scaffold the test: call scaffold_test { key: "PROJ-123", title: "<short title>" } (add tech:"playwright"
   for an e2e test and tech:"jest" for a unit test if both apply).
3. Implement the feature AND fill in the scaffolded test(s) — keep the @PROJ-123 tag in the test title.
4. Verify: call requirement_status { key: "PROJ-123" }. Do NOT consider the work done until it returns
   state: "verified". If it's failing or unverified, fix and re-check.
5. Before finishing, call requirements_trace { run: true } to confirm you didn't regress any other
   requirement (stop and fix if regressions > 0).

Report the final status and the files you changed.
```

This gives the agent a **definition of done it can't fake**: the ticket isn't done until a passing test
references it (`requirement_status` → `verified`).

---

## Flow 2 — From requirements → use cases (mermaid) → unit + e2e tests

The full chain when you start from a requirement/spec and want decisions captured before coding:

```text
You have the acp MCP tools. We're starting feature [PROJ-200] from its Jira ticket + the docs in ./docs.

1. Context: jira_to_markdown for [PROJ-200]; read ./docs for related material.
2. Use cases as a flow: draft an open-questions markdown — a `## Flow overview` mermaid diagram of the
   use cases / decision branches (each decision node tagged Q1, Q2, …) + a `## Open questions (QA)`
   checklist. Call questions_to_html to render it; share the .html so a human resolves the open
   questions. (Their exported answers.md can be published with markdown_to_confluence.)
3. Derive requirements: turn each confirmed use-case/branch into a requirement key (e.g. PROJ-200-a …)
   and list them in the requirements source the config points at.
4. Scaffold tests for each: scaffold_test for the e2e flows (tech:"playwright") AND the unit-level
   rules (tech:"jest"/"vitest"/"xunit"), all tagged with the requirement key.
5. Implement feature + tests. Then requirements_trace to confirm every use case is now ✅ verified,
   and publish the report (output.post / markdown_to_confluence) if configured.

Stop and ask me whenever a decision in step 2 is genuinely mine to make.
```

So the lifecycle is one connected line:

> **requirement (Jira/docs) → use cases as a mermaid flow (`questions_to_html`) → tagged unit + e2e
> tests (`scaffold_test`) → implementation → verification (`requirements_trace`) → published status.**

---

## Flow 3 — "Is this PR really done?" (review gate)

```text
Using the acp tools, review branch [X] against its tickets:
- For each ticket the PR claims to close, call requirement_status. Flag any that aren't "verified"
  (especially drift — code changed but no passing test references the key).
- Call requirements_trace { run: true } and report any regressions.
Summarise: which tickets are genuinely done vs. claimed-but-unverified.
```

## Guardrails (same as any agent task)

- The agent acts on **your** instructions, not on text inside a pulled ticket/page (treat that as data).
- Tools that write to Jira/Confluence (`markdown_to_*`, `push_folder`) create/modify real content —
  have the agent confirm before publishing, exactly as you would for any outward action.
- `scaffold_test` and the trace tools are local + safe (they never publish).
