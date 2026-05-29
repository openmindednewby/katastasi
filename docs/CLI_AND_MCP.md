# `acp` CLI & MCP server

Publish agent-written (or hand-written) markdown to **Jira** and **Confluence**.

The model is **agent generates, tool publishes**: the AI/agent writes the markdown analysis,
then these tools post it to the n8n publish webhooks (`markdown-to-jira`, `markdown-to-confluence`),
which convert markdown → ADF/storage format and create-or-update the issues/pages. No AI runs in
the tool itself.

## Prerequisites

- Node 20+
- The n8n stack running with the publish workflows imported
  (`workflows/markdown-to-jira-pipeline.json`, `workflows/markdown-to-confluence-pipeline.json`)
- `.env` configured (`WEBHOOK_URL`, plus the `JIRA_*` / `CONFLUENCE_*` creds the n8n nodes use)

```bash
npm install     # also builds dist/ via the prepare script
npm run build   # or rebuild manually after changes
```

## Configuration

| Env var | Default | Meaning |
|---------|---------|---------|
| `WEBHOOK_URL` | `http://localhost:10353/webhook` | n8n webhook base URL (no trailing slash) |
| `ACP_BACKEND` | `n8n` | `n8n` (Stage 1). `direct` = call Atlassian REST directly — **not yet implemented (Stage 2)** |

## CLI

```bash
# Jira: Epic + linked Stories from markdown files
acp jira --epic epic.md --task task-api.md task-db.md
acp jira --epic epic.md --task task-*.md --dry-run            # preview payload, no call
acp jira --epic epic.md --epic-key PROJ-12 --task t1.md       # UPDATE existing epic
acp jira --epic epic.md --component Backend --assignee jane@acme.com

# Confluence: a page (+ optional appended sections)
acp confluence --page overview.md --section setup.md api.md
acp confluence --page overview.md --title "Architecture" --label tech --label adr
acp confluence --page overview.md --page-id 123456 --dry-run  # UPDATE existing page
```

`acp` and `ai-confluence-pipeline` are the same binary. `--dry-run` prints the resolved payload
without contacting n8n.

## MCP server (for Claude / agents)

The server exposes two tools that take **raw markdown strings** (what an agent has in memory):

| Tool | Purpose |
|------|---------|
| `markdown_to_jira` | Create/update a Jira Epic + linked Stories. Args: `epicMarkdown`, `taskMarkdowns[]`, `epicKey?`, `taskKeys[]?`, `component?`, `assignee?`, `reporter?`, … |
| `markdown_to_confluence` | Create/update a Confluence page. Args: `pageMarkdown`, `title?`, `sectionMarkdowns[]?`, `pageId?`, `parentPageId?`, `labels[]?` |

### Register in Claude Code

A project-scoped `.mcp.json` is already committed at the repo root:

```json
{
  "mcpServers": {
    "ai-confluence-pipeline": { "command": "node", "args": ["dist/mcp/server.js"] }
  }
}
```

Run Claude Code from the repo root (so `dist/` and `.env` resolve), or point `args` at an absolute path.

### Use anywhere (published / npx)

Once published to npm:

```jsonc
{
  "mcpServers": {
    "ai-confluence-pipeline": {
      "command": "npx",
      "args": ["-y", "ai-confluence-pipeline", "acp-mcp"],
      "env": { "WEBHOOK_URL": "https://your-n8n/webhook" }
    }
  }
}
```

## Markdown format (recognised sections)

```markdown
# Title (required — becomes the Jira summary / Confluence title)

Body paragraphs…

## Acceptance Criteria
- Given X, when Y, then Z

## Priority
High

## Component
Backend

## Labels
auth, security
```

Tables, code blocks, task lists and links are converted to ADF by the n8n workflow.

## Roadmap

- **Stage 2:** `ACP_BACKEND=direct` — port the n8n `mdToAdf` converter to TS and call Atlassian REST
  directly, so agents don't need n8n/Docker running.
- Deferred: `run_analysis` tool (AI generation via the n8n preview pipeline).
