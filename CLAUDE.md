# CLAUDE.md

**Read [AGENTS.md](AGENTS.md) first — it's the canonical onboarding (repo map, setup, build/test,
deploy, conventions).** This file only adds Claude Code specifics.

## Claude Code specifics

- **MCP**: this repo *is* an MCP server (`acp-mcp`). `.mcp.json` registers it for local dev
  (`node dist/mcp/server.js`); run `npm run build` first so `dist/` exists. To use the containerised
  server instead, see [docs/DEPLOY.md](docs/DEPLOY.md#register-the-mcp-server-so-an-agent-can-use-it).
- **Verify your changes** with `npm test` (it builds, then runs `node --test`) and `npm run typecheck`.
  This is a standalone repo — there is **no Tilt MCP / Jest / vitest** here; ignore any habit of
  reaching for those. Don't start long-running dev servers.
- **Imports use `.js` extensions** on relative paths (NodeNext ESM), even from `.ts` files. Keep it.
- **Commit/push only when asked.** When you do commit, end the message with the
  `Co-Authored-By: Claude …` trailer.
- **Atlassian creds** live in `.env` (`JIRA_*` / `CONFLUENCE_*`). Never echo a token; never create real
  Jira/Confluence content just to "verify" — tests mock the network.

## Quick command reference

| Task | Command |
|------|---------|
| Build | `npm run build` |
| Typecheck | `npm run typecheck` |
| Test (builds first) | `npm test` |
| Run the CLI locally | `node dist/cli/index.js <cmd>` (e.g. `trace --config acp-trace.json`) |
| Build the Docker image | `./scripts/docker-build.sh` |
| Deploy (local/remote) | `./scripts/getting-started.sh` → [docs/DEPLOY.md](docs/DEPLOY.md) |
