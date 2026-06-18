# Ready-to-use deploy prompts

Paste-ready prompts that make a Claude agent deploy the `ai-confluence-pipeline` Docker image —
either to your **local Docker Desktop** or to a **remote Docker host over SSH** (no registry).
Both delegate to the repo's scripts, so the agent runs a handful of commands and verifies the result.

Run the agent from inside a cloned `ai-confluence-pipeline` checkout. Fill in the bracketed values.

> The fastest path without an agent is just the script:
> ```bash
> ./scripts/getting-started.sh                 # interactive: asks local vs remote
> ./scripts/getting-started.sh local --with-n8n
> ./scripts/getting-started.sh remote me@host --ssh-key ~/.ssh/id_ed25519
> ```
> The prompts below wrap that same flow with verification + guardrails for an autonomous agent.

---

## Prompt A — Local Docker Desktop

```text
You are deploying the "ai-confluence-pipeline" Docker image to my LOCAL Docker Desktop. Work
autonomously, run the commands yourself, and report the result of each step. Stop only for a secret
or an error you can't resolve.

CONTEXT
- This repo builds an image exposing two bins: `acp` (CLI: publish / pull-jira / pull-confluence /
  push-folder) and `acp-mcp` (stdio MCP server, the default CMD).
- It talks to Atlassian via direct REST (pull/push) and/or the n8n webhooks (publish). It reads
  JIRA_* / CONFLUENCE_* / WEBHOOK_URL from the environment.
- My Atlassian site: [https://YOURCOMPANY.atlassian.net]   My Jira project key: [PROJ]

DO THIS, IN ORDER
1. Confirm Docker is running: `docker info` (if not, tell me to start Docker Desktop).
2. If `.env` is missing, copy `.env.example` to `.env`. Show me which JIRA_* / CONFLUENCE_* keys
   still need real values and ASK me — do NOT invent secrets or print my tokens back in full.
3. Run the getting-started script in local mode:
   `./scripts/getting-started.sh local`
   (add `--with-n8n` if I said I also want the n8n publish webhooks running locally).
4. Verify the image works without touching Atlassian:
   - `docker run --rm acp:latest acp --help`  → shows pull-jira / pull-confluence / push-folder
   - `docker run -i --rm acp:latest acp-mcp </dev/null`  → prints "MCP server running on stdio"
5. Add the containerised MCP server to `.mcp.json` (or show me the snippet to add):
   "ai-confluence-pipeline": { "command": "docker",
     "args": ["run","-i","--rm","--env-file","<ABS_PATH>/.env","acp:latest"] }
   Tell me to restart Claude Code and run `/mcp` to confirm the tools appear.

GUARDRAILS
- Never echo my API tokens in a command, URL, or any file other than `.env`.
- Do NOT create real Jira issues / Confluence pages while verifying — use --help / MCP boot only.
- If a step fails, read docs/DOCKER.md and the script output, fix, and retry once before asking me.

When done, give me a 5-line summary: image built, how to run the CLI in Docker, how the MCP tool is
registered, and the one-liner to pull an epic into a mounted folder.
```

---

## Prompt B — Remote Docker host over SSH (no registry)

```text
You are deploying the "ai-confluence-pipeline" Docker image to a REMOTE Docker host over SSH, with
NO registry — by streaming the image (docker save | gzip | ssh 'gunzip | docker load'). Work
autonomously and report each step. Stop only for a secret or an unresolved error.

CONTEXT
- Image exposes `acp` (CLI) and `acp-mcp` (stdio MCP server). Reads JIRA_* / CONFLUENCE_* /
  WEBHOOK_URL from the environment.
- Remote host (user@host): [me@HOST]
- SSH key file: [~/.ssh/id_ed25519]   SSH port: [22]
- Also deploy the n8n stack on the remote? [yes/no]

PRECHECKS
- I have already set up key-based SSH to the remote (test: `ssh -i <KEY> me@HOST 'echo ok'`).
  If that prints "ok", continue. If it prompts for a password, STOP and tell me — you must not type
  interactive passwords; I'll fix the key first.
- The remote has Docker installed and my user can run it (`ssh ... 'docker version'`).

DO THIS, IN ORDER
1. Confirm local Docker is running (`docker info`) and the SSH precheck above passes.
2. If `.env` is missing, copy `.env.example` to `.env` and ASK me for the JIRA_* / CONFLUENCE_*
   values you need. Do NOT print my tokens back in full.
3. Deploy with the getting-started script in remote mode (it builds locally, ships over SSH, copies
   my .env to the remote ~/acp.env, and verifies the image landed):
   `./scripts/getting-started.sh remote [me@HOST] --ssh-key [~/.ssh/id_ed25519] [--port 22]`
   (append `--with-n8n` only if I answered yes above.)
4. Verify on the remote (no Atlassian writes):
   `ssh -i [KEY] [me@HOST] "docker run --rm acp:latest acp --help"`
5. Show me the two ready-to-run remote commands the script printed:
   - CLI pulling an epic (mount a dir): docker run --rm --env-file ~/acp.env -v "$PWD/out:/work/out" acp:latest acp pull-jira [PROJ]-12 /work/out
   - stdio MCP server: docker run -i --rm --env-file ~/acp.env acp:latest

GUARDRAILS
- Never type an interactive SSH/sudo password and never echo my tokens. Use the key file only.
- The image transfer streams over the existing SSH connection (an "SSH tunnel"): no ports opened,
  no registry, nothing pushed to the internet.
- Do NOT create real Jira/Confluence content while verifying.
- On any failure, read docs/DOCKER.md + the script output, fix, retry once, then ask me.

When done, summarise in 5 lines: image shipped to [HOST], how to run the CLI there, where the .env
lives on the remote, and how to attach the MCP server over `docker run -i`.
```

---

## Variant — drive the remote daemon directly (SSH "tunnel" via docker context)

If you'd rather build/run **on** the remote daemon over an SSH connection (instead of save/load),
tell the agent to use a docker context — Docker tunnels the daemon socket over SSH for you:

```bash
docker context create acp-remote --docker "host=ssh://me@HOST"
docker --context acp-remote build -t acp:latest .
docker --context acp-remote run -i --rm --env-file .env acp:latest
```

Use save/load (Prompt B) when the remote can't reach this repo or you want a clean, registry-less
hand-off; use a context when the remote daemon is reachable and you want to build there.
