#!/usr/bin/env bash
# ============================================================================
# One-shot getting-started: build the ai-confluence-pipeline Docker image and
# deploy it either to LOCAL Docker Desktop or to a REMOTE Docker host over SSH
# (no registry — docker save | gzip | ssh 'gunzip | docker load').
#
# Usage:
#   ./scripts/getting-started.sh                          # interactive (asks local/remote)
#   ./scripts/getting-started.sh local                    # build + verify on local Docker
#   ./scripts/getting-started.sh local --with-n8n         # also start the n8n stack (compose)
#   ./scripts/getting-started.sh remote user@host         # ship to a remote host over SSH
#   ./scripts/getting-started.sh remote user@host --ssh-key ~/.ssh/id_ed25519 --with-n8n
#
# Options:
#   --image <tag>     image tag (default: acp:latest)
#   --ssh-key <path>  SSH identity for the remote
#   --port <n>        SSH port (default 22)
#   --with-n8n        also bring up the n8n stack (docker compose) — locally, or on the remote
#   --no-build        reuse an already-built local image
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

IMAGE="acp:latest"
MODE=""
TARGET=""
SSH_KEY=""
SSH_PORT="22"
WITH_N8N=false
BUILD=true

# ── parse args ──────────────────────────────────────────────────────────────
if [[ "${1:-}" == "local" || "${1:-}" == "remote" ]]; then
  MODE="$1"; shift
  if [ "$MODE" = "remote" ]; then
    TARGET="${1:-}"
    if [ -z "$TARGET" ] || [[ "$TARGET" == -* ]]; then echo "remote needs user@host"; exit 1; fi
    shift
  fi
fi
while [[ $# -gt 0 ]]; do
  case "$1" in
    --image) IMAGE="$2"; shift 2 ;;
    --ssh-key) SSH_KEY="$2"; shift 2 ;;
    --port) SSH_PORT="$2"; shift 2 ;;
    --with-n8n) WITH_N8N=true; shift ;;
    --no-build) BUILD=false; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── interactive mode pick ───────────────────────────────────────────────────
if [ -z "$MODE" ]; then
  if [ -t 0 ]; then
    echo "Where do you want to deploy ai-confluence-pipeline?"
    echo "  1) Local Docker Desktop"
    echo "  2) Remote Docker host over SSH"
    read -rp "Choose [1/2]: " choice
    case "$choice" in
      2) MODE="remote"; read -rp "Remote target (user@host): " TARGET ;;
      *) MODE="local" ;;
    esac
  else
    MODE="local"  # non-interactive default
  fi
fi

echo ""
echo "==================================================================="
echo "  ai-confluence-pipeline getting-started"
echo "  mode: $MODE${TARGET:+  target: $TARGET}   image: $IMAGE   n8n: $WITH_N8N"
echo "==================================================================="

# ── prerequisites ───────────────────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || { echo "ERROR: Docker is not installed / not on PATH."; exit 1; }
docker info >/dev/null 2>&1 || { echo "ERROR: Docker daemon not reachable. Start Docker Desktop and retry."; exit 1; }

if [ ! -f .env ]; then
  echo "==> No .env found — creating one from .env.example."
  cp .env.example .env
  echo "    Edit .env and fill in JIRA_* / CONFLUENCE_* before using the pull/push/publish features."
fi

# ── build ───────────────────────────────────────────────────────────────────
if [ "$BUILD" = true ]; then
  echo "==> Building image $IMAGE ..."
  docker build -t "$IMAGE" "$PROJECT_DIR"
else
  echo "==> Skipping build (--no-build)."
fi

# ── deploy ──────────────────────────────────────────────────────────────────
if [ "$MODE" = "local" ]; then
  echo "==> Verifying the image runs locally..."
  docker run --rm "$IMAGE" acp --version >/dev/null && echo "    acp CLI OK"
  docker run -i --rm "$IMAGE" acp-mcp </dev/null 2>&1 | head -1

  if [ "$WITH_N8N" = true ]; then
    echo "==> Starting the n8n stack (docker compose up -d)..."
    docker compose up -d
    echo "    n8n UI: http://localhost:10353 (import + activate the workflows/ as in docs/INSTALL.md)"
  fi

  cat <<EOF

==> Local deploy done. Try:
    docker run --rm --env-file .env -v "\$PWD/out:/work/out" $IMAGE acp pull-jira PROJ-12 /work/out
    docker run --rm --env-file .env -v "\$PWD/out:/work/out" $IMAGE acp push-folder /work/out

  Register the MCP server with Claude Code (.mcp.json):
    "ai-confluence-pipeline": { "command": "docker",
      "args": ["run","-i","--rm","--env-file","$PROJECT_DIR/.env","$IMAGE"] }
EOF

else
  echo "==> Deploying to remote $TARGET over SSH..."
  DEPLOY_ARGS=("$TARGET" --image "$IMAGE" --no-build --env-file .env)
  [ -n "$SSH_KEY" ] && DEPLOY_ARGS+=(--ssh-key "$SSH_KEY")
  [ "$SSH_PORT" != "22" ] && DEPLOY_ARGS+=(--port "$SSH_PORT")
  bash "$SCRIPT_DIR/docker-deploy-remote.sh" "${DEPLOY_ARGS[@]}"

  if [ "$WITH_N8N" = true ]; then
    echo "==> Bringing up the n8n stack on $TARGET ..."
    SSH_OPTS=(-p "$SSH_PORT"); SCP_OPTS=(-P "$SSH_PORT")
    [ -n "$SSH_KEY" ] && { SSH_OPTS+=(-i "$SSH_KEY"); SCP_OPTS+=(-i "$SSH_KEY"); }
    ssh "${SSH_OPTS[@]}" "$TARGET" "mkdir -p ~/acp-pipeline"
    scp "${SCP_OPTS[@]}" docker-compose.yml "$TARGET:~/acp-pipeline/docker-compose.yml"
    scp "${SCP_OPTS[@]}" .env "$TARGET:~/acp-pipeline/.env"
    ssh "${SSH_OPTS[@]}" "$TARGET" "cd ~/acp-pipeline && docker compose up -d"
    echo "    n8n is starting on the remote (port from .env N8N_PORT, default 10353)."
  fi

  echo ""
  echo "==> Remote deploy done. On $TARGET the image '$IMAGE' is loaded and ready."
fi
