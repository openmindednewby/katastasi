# syntax=docker/dockerfile:1
# ============================================================================
# ai-confluence-pipeline — CLI + MCP server image.
#
# Multi-stage: build the TS in a full-toolchain stage, ship only prod deps + dist.
# The image exposes both bins on PATH:
#   acp       → the CLI            (docker run --rm --env-file .env IMG acp pull-jira PROJ-1 /work/out)
#   acp-mcp   → the stdio MCP srv  (docker run -i --rm --env-file .env IMG)        # default CMD
#
# Reads JIRA_* / CONFLUENCE_* / WEBHOOK_URL from the environment (pass --env-file .env).
# Mount a host dir at /work to get pulled folders out: -v "$PWD/out:/work/out".
# ============================================================================

# ── Build stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: the `prepare` lifecycle would run `build` before src is copied.
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Runtime stage ───────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Prod dependencies only. `npm ci --omit=dev` runs `prepare` (build) by default, which
# would need the TS toolchain we dropped — skip lifecycle scripts, we copy dist in next.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY --from=build /app/dist ./dist

# Expose both bins on PATH (the entry files carry a `#!/usr/bin/env node` shebang).
RUN chmod +x dist/cli/index.js dist/mcp/server.js \
  && ln -s /app/dist/cli/index.js /usr/local/bin/acp \
  && ln -s /app/dist/cli/index.js /usr/local/bin/ai-confluence-pipeline \
  && ln -s /app/dist/mcp/server.js /usr/local/bin/acp-mcp

# Default working area for mounted output folders (pull-jira / pull-confluence targets).
RUN mkdir -p /work
WORKDIR /work

# Default: run the stdio MCP server (attach with `docker run -i`).
CMD ["acp-mcp"]
