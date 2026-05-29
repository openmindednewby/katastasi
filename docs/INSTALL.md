# Installation

This repo ships three ways to drive the pipeline:

1. **n8n + browser UI** (`trigger.html`) — visual, now with **session save/export/remember**.
2. **`acp` CLI** — publish markdown to Jira/Confluence from a terminal.
3. **MCP server** — let Claude agents publish the markdown they write.

All three publish through the same n8n webhooks (`markdown-to-jira`, `markdown-to-confluence`).
A ready-to-paste setup prompt is in [`docs/SETUP_PROMPT.md`](SETUP_PROMPT.md) — hand it to Claude Code
to do all of this for you.

---

## 1. Prerequisites

- **Node 20+** (`node --version`)
- **Docker + Docker Compose** (for n8n)
- **Confluence / Jira Cloud** + an Atlassian **API token**
  (<https://id.atlassian.com/manage-profile/security/api-tokens>)

## 2. Clone + configure

```bash
git clone https://github.com/openmindednewby/ai-confluence-pipeline.git
cd ai-confluence-pipeline
cp .env.example .env
# Edit .env — set CONFLUENCE_* and JIRA_* (see docs/SETUP.md for each field)
```

## 3. Start n8n and import the publish workflows

```bash
docker compose up -d            # n8n at http://localhost:10353
```

In the n8n UI (login with `N8N_BASIC_AUTH_USER` / `N8N_BASIC_AUTH_PASSWORD` from `.env`):

1. Create the **Jira Basic Auth** credential (email + API token) — used by the Jira nodes.
2. **Import** `workflows/markdown-to-jira-pipeline.json` and `workflows/markdown-to-confluence-pipeline.json`.
3. **Activate** both workflows (toggle top-right) so their webhooks are live.

Quick check the webhook is reachable:

```bash
curl -s -X POST http://localhost:10353/webhook/markdown-to-confluence \
  -H 'Content-Type: application/json' \
  -d '{"pageMarkdown":"# Smoke test\nhello"}'
```

## 4. Build the CLI + MCP server

```bash
npm install          # installs deps AND builds dist/ (via the prepare script)
npm run build        # rebuild after any source change
```

This produces:

- `dist/cli/index.js` → the `acp` / `ai-confluence-pipeline` CLI
- `dist/mcp/server.js` → the MCP stdio server

### Try the CLI

```bash
node dist/cli/index.js jira \
  --epic examples/epic-folder/epic.md \
  --task examples/epic-folder/task-01-api.md examples/epic-folder/task-02-database.md --dry-run
```

Remove `--dry-run` to actually create the Epic + Stories. Full reference: [`docs/CLI_AND_MCP.md`](CLI_AND_MCP.md).

Optionally link the CLI globally:

```bash
npm link             # then: acp jira --epic ... / acp confluence --page ...
```

## 5. Register the MCP server with Claude Code

A project-scoped `.mcp.json` is already committed at the repo root:

```json
{
  "mcpServers": {
    "ai-confluence-pipeline": { "command": "node", "args": ["dist/mcp/server.js"] }
  }
}
```

Run `claude` from the repo root so `dist/` and `.env` resolve. Inside Claude Code, `/mcp` should list
`ai-confluence-pipeline` with the `markdown_to_jira` and `markdown_to_confluence` tools.

**Use it anywhere (after publishing to npm):**

```json
{
  "mcpServers": {
    "ai-confluence-pipeline": {
      "command": "npx",
      "args": ["-y", "ai-confluence-pipeline", "acp-mcp"],
      "env": { "WEBHOOK_URL": "http://localhost:10353/webhook" }
    }
  }
}
```

## 6. (Optional) Browser UI with session memory

Open `trigger.html` (serve it, e.g. `npx serve .`, or open the file directly). The **Sessions** bar
remembers your last form state automatically and lets you save/load named sessions and export/import
them as JSON. See [`docs/SESSIONS.md`](SESSIONS.md).

---

## Configuration reference

| Env var | Used by | Meaning |
|---------|---------|---------|
| `WEBHOOK_URL` | CLI, MCP | n8n webhook base URL (default `http://localhost:10353/webhook`) |
| `ACP_BACKEND` | CLI, MCP | `n8n` (default). `direct` is reserved for Stage 2 (not yet implemented) |
| `CONFLUENCE_*` | n8n | Confluence base URL, email, API token, space key, parent page |
| `JIRA_*` | n8n | Jira base URL, email, API token, project key, default issue types |
| `N8N_*` | docker | n8n port + basic auth + encryption key |

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Cannot reach n8n at localhost:10353` | `docker compose up -d`; confirm both workflows are **Active** |
| CLI prints `... returned non-JSON` | The webhook isn't the publish workflow — re-import and activate it |
| `ACP_BACKEND=direct is not implemented` | Set `ACP_BACKEND=n8n` (or unset it) |
| MCP tools don't appear in Claude Code | Run `claude` from the repo root; run `npm run build` first |
