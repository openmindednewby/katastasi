# Task: `ai-confluence-pipeline` CLI + MCP server

## Goal
Let Claude agents (and humans) drive the pipeline from instructions. Agent **generates** the
markdown analysis; the tool **publishes** it. TypeScript/Node, one package, shared `core`.

## Decisions (locked)
- **Package name:** `ai-confluence-pipeline` (unscoped).
- **AI ownership:** agent generates, tool publishes (no AI inside the tool).
- **Runtime:** TypeScript / Node 22.
- **Backend — Stage 1 (this task):** POST to existing n8n webhooks. No new webhook needed —
  `markdown-to-jira` and `markdown-to-confluence` already exist, are publish-only, and are more
  capable than the `folder-to-*` bash scripts (create-or-update, ADF tables/code, assignee resolution).
- **Backend — Stage 2 (later):** port the n8n `mdToAdf` converter to TS for a direct-REST path
  selected by `ACP_BACKEND=direct`.
- **Scope now:** only `markdown-to-jira` + `markdown-to-confluence`. `run_analysis` (AI via n8n) deferred.

## n8n payload contracts (confirmed from workflow JSON)
- `POST {WEBHOOK_URL}/markdown-to-jira`
  `{ epicMarkdown, taskMarkdowns[], epicKey?, taskKeys[]?, taskAssignees[]?, component?, assignee?, reporter?, issueType?, parentKey? }`
- `POST {WEBHOOK_URL}/markdown-to-confluence`
  `{ title?, pageMarkdown, sectionMarkdowns[]?, pages[]?, pageId?, parentPageId?, labels[]? }`

## Structure
```
src/
  core/   config.ts, n8n.ts, jira.ts, confluence.ts, types.ts
  cli/    index.ts            (bin: ai-confluence-pipeline / acp)
  mcp/    server.ts           (stdio MCP)
```

## Tools / commands
| MCP tool | CLI command | Input |
|---|---|---|
| `markdown_to_jira` | `acp jira` | raw markdown strings (agent) / `--epic --task` files (cli) |
| `markdown_to_confluence` | `acp confluence` | raw markdown strings (agent) / `--page --section` files (cli) |

## Progress
- [x] Scaffold package (package.json, tsconfig, .gitignore additions, prepare=build)
- [x] core: config + n8n client + types
- [x] core: jira + confluence publish functions (validation + n8n post)
- [x] CLI commands `acp jira` / `acp confluence` (file-path inputs, --dry-run) — verified vs examples/
- [x] MCP stdio server (raw-markdown inputs) — initialize + tools/list handshake verified
- [x] .mcp.json + docs/CLI_AND_MCP.md + README roadmap update
- [x] Smoke test: build clean, typecheck clean, CLI dry-run, MCP handshake

## Remaining (not done — needs live n8n)
- [ ] End-to-end run against a running n8n + real Jira/Confluence sandbox
- [ ] Unit tests for payload builders (toWebhookBody) + validators

## Docs + setup prompt (added)
- [x] docs/INSTALL.md — full install (n8n + CLI + MCP), config table, troubleshooting
- [x] docs/CLI_AND_MCP.md — CLI/MCP reference
- [x] docs/SETUP_PROMPT.md — ready-to-paste prompt that makes a Claude agent install & verify everything
- [x] README roadmap + links updated

## Browser UI sessions feature (added)
- [x] trigger.html: Sessions bar (named save/load/delete, export current, export all, import)
- [x] Auto-save last config to localStorage (debounced) + auto-restore on load + clear persists
- [x] collectState/applyState mirror the full form incl. dynamic task & confluence-page rows
- [x] docs/SESSIONS.md
- [x] Verified in Chrome: snapshot/restore, named save, auto-save, reload-restore, export shape,
      import merge — all pass, zero console errors. Test localStorage artifacts cleaned up.

## Stage 2 (separate task)
- [ ] `ACP_BACKEND=direct`: port n8n `mdToAdf` converter to TS, call Atlassian REST directly

## Status: STAGE 1 + DOCS + UI-SESSIONS CODE-COMPLETE (Jira/Confluence live e2e still pending real n8n)
