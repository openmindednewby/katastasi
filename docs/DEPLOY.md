# Deploy on a Docker host (simple guide)

The whole tool ships as one small (~64 MB) Node 22 Alpine image that exposes both bins:

| Bin | What it is | How you run it |
|-----|-----------|----------------|
| `acp` | the CLI — `jira` / `confluence` (publish), `pull-jira` / `pull-confluence`, `push-folder`, `trace` | `docker run --rm … IMG acp <cmd>` |
| `acp-mcp` | the stdio MCP server (default `CMD`) — for agents | `docker run -i --rm … IMG` |

It reads `JIRA_*` / `CONFLUENCE_*` / `WEBHOOK_URL` from the environment (`--env-file .env`). Mount a host
dir at `/work` to read/write pulled folders or trace reports.

---

## TL;DR — one command

From a clone of this repo, on a machine with Docker:

```bash
./scripts/getting-started.sh                 # interactive: asks local or remote
./scripts/getting-started.sh local           # build + verify on local Docker Desktop
./scripts/getting-started.sh remote me@host --ssh-key ~/.ssh/id_ed25519
```

PowerShell: `./scripts/getting-started.ps1 -Mode local` (or `-Mode remote -Target me@host`).

That builds the image, creates `.env` from the example if missing, verifies both bins boot, and prints
the run commands. Everything below is the same flow, done by hand.

---

## A. Local Docker host

```bash
cp .env.example .env          # then edit: set JIRA_* / CONFLUENCE_*
./scripts/docker-build.sh     # builds image  acp:latest
docker run --rm acp:latest acp --help        # verify CLI
docker run -i --rm acp:latest acp-mcp </dev/null   # verify MCP boots ("running on stdio")
```

Use it (mount a folder for outputs):

```bash
docker run --rm --env-file .env -v "$PWD/out:/work/out" acp:latest acp pull-jira PROJ-12 /work/out
docker run --rm --env-file .env -v "$PWD/work:/work" acp:latest acp trace --config /work/acp-trace.json
```

---

## B. Remote Docker host — no registry (stream over SSH)

For a host that doesn't have the image, ship it over the existing SSH connection —
`docker save | gzip | ssh 'gunzip | docker load'`. No registry, nothing pushed to the internet.

```bash
# Build locally + stream to the remote, copy your .env across, verify it landed:
./scripts/docker-deploy-remote.sh me@host --ssh-key ~/.ssh/id_ed25519 --env-file .env

# Optional: run a command once it lands
./scripts/docker-deploy-remote.sh me@host --run "acp --help"

# Ship an already-built image (skip the local build):
./scripts/docker-deploy-remote.sh me@host --no-build
```

PowerShell: `scripts\docker-deploy-remote.ps1 -Target me@host -SshKey … -EnvFile .env`.

**Precondition:** key-based SSH already works (`ssh -i <key> me@host 'echo ok'`) and the remote has
Docker. The script never types interactive passwords.

Then on the remote:

```bash
ssh me@host 'docker run --rm --env-file ~/acp.env -v "$PWD/out:/work/out" acp:latest acp pull-jira PROJ-12 /work/out'
ssh -t me@host 'docker run -i --rm --env-file ~/acp.env acp:latest'   # MCP, on demand
```

### Alternative — build on the remote over an SSH tunnel (docker context)

If the remote daemon is SSH-reachable and you'd rather build there:

```bash
docker context create acp-remote --docker "host=ssh://me@host"
docker --context acp-remote build -t acp:latest .
docker --context acp-remote run -i --rm --env-file .env acp:latest
```

Use **save/load** for a clean registry-less hand-off; use a **context** to build on the remote.

---

## Register the MCP server (so an agent can use it)

The MCP server is stdio — run it on demand via `docker run -i`. Point your agent at it:

```jsonc
// .mcp.json
{
  "mcpServers": {
    "ai-confluence-pipeline": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "--env-file", "/abs/path/.env", "acp:latest"]
    }
  }
}
```

(For a remote host, prefix with `ssh -t me@host` and use `~/acp.env`.)

---

## Want an agent to do the whole deploy?

Paste-ready prompts (local + remote, with guardrails) are in **[DEPLOY_PROMPT.md](DEPLOY_PROMPT.md)**.
Deeper reference (build flags, what each script does, n8n stack) is in **[DOCKER.md](DOCKER.md)**.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Docker daemon not reachable` | Start Docker Desktop / `systemctl start docker`. |
| build fails in the `npm ci` step | The build stage uses `--ignore-scripts`; if you customised the Dockerfile, keep that flag (the `prepare` hook builds TS before src is copied otherwise). |
| remote deploy asks for a password | Key-based SSH isn't set up; the scripts won't type passwords. Fix the key, retry. |
| CLI runs but Atlassian calls 401 | `JIRA_*` / `CONFLUENCE_*` not passed — use `--env-file .env` (local) or `~/acp.env` (remote). |
