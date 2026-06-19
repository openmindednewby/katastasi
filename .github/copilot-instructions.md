# GitHub Copilot instructions

**Read [`AGENTS.md`](../AGENTS.md) first** — it's the canonical onboarding for this repo (what it is,
the file map, setup, build/test commands, deploy, and conventions). This file only highlights the
must-knows.

## Must-knows

- **ESM, NodeNext.** Relative imports use a **`.js`** extension even from `.ts` files
  (`import { x } from './y.js'`). Match it or the build breaks.
- **Build before tests.** Tests are plain `node --test` files importing from `dist/`. Use `npm test`
  (it builds first) and `npm run typecheck`. There is no Jest/vitest/Tilt here.
- **Core logic stays n8n-free.** Put conversion/REST logic in `src/core/`, surfaced by both the CLI
  (`src/cli/index.ts`) and the MCP server (`src/mcp/server.ts`). Don't duplicate it into scripts.
- **Hand-rolled parsers on purpose** (glob, mini-YAML, XML/JUnit, markdown). Don't add libraries
  without a clear reason; current deps are `commander`, `@modelcontextprotocol/sdk`, `zod`, `dotenv`.
- **Add a fixture-based test** for new behaviour (no live Atlassian — network is mocked/injected).
- **Round-trip safety**: pull → edit → push must stay lossless.

## Deploy

One Docker image exposes `acp` (CLI) + `acp-mcp` (MCP). Simple guide: [`docs/DEPLOY.md`](../docs/DEPLOY.md);
fastest path `./scripts/getting-started.sh`.
