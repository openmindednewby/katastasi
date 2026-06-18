# Docker image & remote deploy

The `ai-confluence-pipeline` CLI + MCP server ship as a small (~64 MB) Node 22 Alpine image.
It exposes both bins on `PATH`:

| Bin | Purpose | Run as |
|-----|---------|--------|
| `acp` | the CLI (publish / pull / push-folder) | `docker run --rm … IMG acp <cmd>` |
| `acp-mcp` | the stdio MCP server (default `CMD`) | `docker run -i --rm … IMG` |

The image reads `JIRA_*` / `CONFLUENCE_*` / `WEBHOOK_URL` from the environment — pass `--env-file .env`.
Mount a host dir at `/work` to retrieve pulled folders.

## Fastest path — getting-started script

One script builds the image and deploys it to local Docker Desktop **or** a remote host over SSH:

```bash
./scripts/getting-started.sh                                  # interactive: asks local vs remote
./scripts/getting-started.sh local --with-n8n                # build + verify locally (+ n8n stack)
./scripts/getting-started.sh remote me@host --ssh-key ~/.ssh/id_ed25519
```

PowerShell: `./scripts/getting-started.ps1 -Mode local` / `-Mode remote -Target me@host`.

Want an **agent** to do it autonomously? Paste-ready prompts (local + remote, with guardrails) are in
**[docs/DEPLOY_PROMPT.md](DEPLOY_PROMPT.md)**.

## Build

```bash
./scripts/docker-build.sh                # acp:latest
./scripts/docker-build.sh myreg/acp:1.0  # custom tag
# or: npm run docker:build -- myreg/acp:1.0
```

## Run locally

```bash
# Pull a Jira epic into ./out (mounted at /work/out):
docker run --rm --env-file .env -v "$PWD/out:/work/out" acp:latest \
  acp pull-jira PROJ-12 /work/out

# Push an edited folder back:
docker run --rm --env-file .env -v "$PWD/out:/work/out" acp:latest \
  acp push-folder /work/out

# Run the stdio MCP server (an agent attaches over `docker run -i`):
docker run -i --rm --env-file .env acp:latest
```

### Register the containerised MCP server with Claude Code

```jsonc
{
  "mcpServers": {
    "ai-confluence-pipeline": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "--env-file", "/abs/path/.env", "acp:latest"]
    }
  }
}
```

## Deploy to a remote Docker host (no registry)

For a remote host that does **not** have the image, stream it over SSH —
`docker save | gzip | ssh 'gunzip | docker load'`. No registry, no marketplace, just SSH.

```bash
# Build locally + ship to the remote:
./scripts/docker-deploy-remote.sh user@host

# Custom tag + SSH key + copy your .env over + run a command once it lands:
./scripts/docker-deploy-remote.sh user@host \
  --image acp:1.0 --ssh-key ~/.ssh/id_ed25519 \
  --env-file .env \
  --run "acp pull-jira PROJ-12 /work/out"

# Ship an already-built image (skip the local build):
./scripts/docker-deploy-remote.sh user@host --no-build
```

PowerShell equivalents: `scripts\docker-build.ps1`, `scripts\docker-deploy-remote.ps1`
(`-Target user@host -Image … -SshKey … -EnvFile … -Run "…" -NoBuild`).

What the deploy script does:
1. `docker build` locally (unless `--no-build`).
2. Checks the remote actually has `docker`.
3. `docker save IMG | gzip | ssh host 'gunzip | docker load'`.
4. Verifies the image landed (`docker image inspect`).
5. Optionally `scp`s your `.env` to `~/acp.env` and/or runs one command.
6. Prints ready-to-use `docker run` lines for the remote.

The only remote requirement is Docker + SSH access. The MCP server is stdio, so on the remote
you run it on demand (`docker run -i …`) rather than as a long-lived daemon.

### Alternative — drive the remote daemon over an SSH tunnel (docker context)

Instead of save/load you can point Docker at the remote daemon over SSH (Docker tunnels the socket):

```bash
docker context create acp-remote --docker "host=ssh://me@host"
docker --context acp-remote build -t acp:latest .          # builds on the remote
docker --context acp-remote run -i --rm --env-file .env acp:latest
```

Use **save/load** when the remote can't reach this repo or you want a clean registry-less hand-off;
use a **context** when the remote daemon is SSH-reachable and you'd rather build there.
