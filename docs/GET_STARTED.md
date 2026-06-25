# Get started with Katastasi

Two ways: paste the **agent prompt** into your AI coding tool, or run the **commands** yourself.

## Option A — paste into your AI agent (Claude Code / Copilot / Cursor)

> Set up **Katastasi** in this repository and get me started. It's a local-first documentation,
> task-tracking & testing toolkit (CLI `katastasi` + an MCP server + drop-in agent skills) — everything
> stays in this repo as markdown; Jira/Confluence/GitHub are optional. Do this:
>
> 1. Check Node ≥ 20, then confirm the CLI: `npx katastasi@latest --help`.
> 2. Install the agent skills into this repo: `npx katastasi@latest init-skills` (writes `.claude/skills/*`
>    and a Katastasi block in `.github/copilot-instructions.md`).
> 3. **Only if** we'll connect Jira/Confluence/GitHub: create a local `.env` with `JIRA_BASE_URL`,
>    `JIRA_EMAIL`, `JIRA_API_TOKEN`, `CONFLUENCE_BASE_URL` (…/wiki), `CONFLUENCE_EMAIL`,
>    `CONFLUENCE_API_TOKEN`, `GITHUB_TOKEN`. Atlassian token:
>    https://id.atlassian.com/manage-profile/security/api-tokens . Skip for local-markdown-only.
> 4. Initialize traceability: `npx katastasi@latest trace init` (autodetects the test framework +
>    requirements → `acp-trace.json`).
> 5. Launch the feature wizard: `npx katastasi@latest web` → open http://localhost:8799 → **Connect** (saves
>    creds locally) → **Source** (paste a Jira epic or Confluence page URL) → **Select** (confirm the
>    discovered issues + pages) → **Download** (pull as markdown) → **Design** (AI: system data-flow diagram
>    + DB/migration changes + dependency-ordered tasks + tests + ready-made curls) → **Sync** (task status
>    ⇄ Jira/GitHub). For local-markdown-only: write `docs/requirements.md`, then
>    `npx katastasi@latest task add "…" --req KEY`.
> 6. Verify: `npx katastasi@latest trace --run` — shows which requirements are actually verified at this commit.
>
> Then report: what you installed, the generated feature-pack path, and the trace summary.

## Option B — run it yourself

```bash
# one-time per repo
npx katastasi@latest init-skills        # agent skills for Claude/Copilot (optional)
npx katastasi@latest trace init         # autodetect tests + requirements → acp-trace.json

# the feature wizard (browser, 100% local, no login)
npx katastasi@latest web                # → http://localhost:8799

# or stay in the terminal / markdown-only
npx katastasi@latest task add "Implement login" --req PROJ-1
npx katastasi@latest test               # run acceptance tests
npx katastasi@latest trace --run        # which requirements are verified now?
npx katastasi@latest sync               # preview task ⇄ Jira/GitHub (then --apply)
```

Prefer not to use npx each time? `npm i -g katastasi`. First-time Jira/Confluence/GitHub credentials:
[SOURCES_SETUP.md](SOURCES_SETUP.md). The team workflow: [METHODOLOGY.md](METHODOLOGY.md).

## Install the MCP server (so agents can drive it as tools)

Add to your MCP config (e.g. `.mcp.json`):
```json
{ "mcpServers": { "katastasi": { "command": "npx", "args": ["-y", "katastasi-mcp"] } } }
```

> **Note:** the `web`, `sync`, and `init-skills` commands require **katastasi ≥ 0.5.0**. Until that's
> published, use the from-source path: `git clone https://github.com/openmindednewby/katastasi && cd
> katastasi && npm install && npm run build`, then `node dist/cli/index.js <command>`.
