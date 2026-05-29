# Ready-to-use setup prompt

Copy the block below into **Claude Code** (run from the directory where you want the repo, or from
inside an already-cloned `ai-confluence-pipeline`). The agent will install and verify the CLI + MCP
server end to end. Fill in the two bracketed values first; leave the rest as-is.

---

```text
You are setting up the "ai-confluence-pipeline" CLI + MCP server on my machine. Work autonomously,
run the commands yourself, and stop to ask me only when you need a secret or hit an error you can't
resolve. After each step, tell me the result before moving on.

CONTEXT
- Repo: https://github.com/openmindednewby/ai-confluence-pipeline
- Goal: a TypeScript `acp` CLI and an MCP server that publish agent-written markdown to Jira and
  Confluence by POSTing to the repo's n8n webhooks (`markdown-to-jira`, `markdown-to-confluence`).
  No AI runs inside the tool — I (the agent) write the markdown, the tool publishes it.
- My Atlassian site: [https://YOURCOMPANY.atlassian.net]
- My Jira project key: [PROJ]

DO THIS, IN ORDER
1. If a `package.json` for "ai-confluence-pipeline" is not already in the working directory, clone
   the repo and cd into it. Otherwise use the current directory.
2. Verify Node >= 20 (`node --version`). If older, stop and tell me.
3. If `.env` does not exist, copy `.env.example` to `.env`. Then show me the CONFLUENCE_* and JIRA_*
   keys that still need real values and ASK me for them — do NOT invent or guess secrets, and do NOT
   print my tokens back in full. I will paste them; you write them into `.env`.
4. Confirm Docker is running, then `docker compose up -d` to start n8n (http://localhost:10353).
   Tell me to open the n8n UI and: (a) create the "Jira Basic Auth" credential, (b) import
   workflows/markdown-to-jira-pipeline.json and workflows/markdown-to-confluence-pipeline.json,
   (c) activate both. Wait for me to confirm they're active before continuing.
5. Smoke-test the Confluence webhook is reachable (do NOT create real content — a 200/JSON response
   or a clear connection result is enough):
   curl -s -X POST http://localhost:10353/webhook/markdown-to-confluence -H 'Content-Type: application/json' -d '{"pageMarkdown":"# setup smoke\nhello"}'
6. `npm install` (this also builds dist/ via the prepare script), then `npm run build` and
   `npm run typecheck`. Fix any build/type errors you introduced.
7. CLI dry-run (no writes): 
   node dist/cli/index.js jira --epic examples/epic-folder/epic.md --task examples/epic-folder/task-01-api.md --dry-run
   Confirm it prints a resolved payload.
8. Verify the MCP server boots and lists its two tools over stdio:
   printf '%s\n%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"setup","version":"0"}}}' '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | node dist/mcp/server.js
   Confirm `markdown_to_jira` and `markdown_to_confluence` appear.
9. Confirm `.mcp.json` exists at the repo root registering the server. Tell me to restart Claude Code
   from this directory and run `/mcp` to confirm the "ai-confluence-pipeline" tools are available.

GUARDRAILS
- Never put my API tokens in a command you echo back, in a URL, or in any file other than `.env`.
- Do not create real Jira issues or Confluence pages during setup — use --dry-run / smoke tests only.
- Read docs/INSTALL.md and docs/CLI_AND_MCP.md if you need detail on any step.

When everything passes, give me a 5-line summary: what's installed, how to run the CLI, how to use
the MCP tools, and how to start n8n next time.
```

---

## After setup — how I'll ask the agent to use it

Once installed, you can instruct any Claude agent in this project like:

> *"Write a technical analysis for &lt;feature&gt; as an Epic plus 4 Stories, then use the
> `markdown_to_jira` tool to create them under component Backend."*

> *"Turn the ADR you just drafted into a Confluence page with `markdown_to_confluence`, labels
> `adr,architecture`."*

The agent writes the markdown and calls the MCP tool; the tool publishes via n8n and returns the
created/updated keys and URLs.
