#!/usr/bin/env bash
# ============================================================================
# Deploy the ai-confluence-pipeline image to a remote Docker host that does NOT
# have it — no registry required. Builds locally, streams the image over SSH
# (docker save | gzip | ssh 'gunzip | docker load'), and optionally runs it.
#
# Usage:
#   ./scripts/docker-deploy-remote.sh user@host
#   ./scripts/docker-deploy-remote.sh user@host --image acp:1.0 --ssh-key ~/.ssh/id_ed25519
#   ./scripts/docker-deploy-remote.sh user@host --env-file .env --run "acp pull-jira PROJ-1 /work/out"
#   ./scripts/docker-deploy-remote.sh user@host --no-build           # ship an already-built image
#
# Options:
#   --image <tag>     image tag to build/ship      (default: acp:latest)
#   --ssh-key <path>  SSH identity file            (default: ssh default)
#   --port <n>        SSH port                     (default: 22)
#   --no-build        skip the local docker build (image must already exist)
#   --env-file <path> scp this .env to the remote (~/acp.env) for `docker run --env-file`
#   --run "<args>"    after load, run `docker run --rm [--env-file] <image> <args>` remotely
#                     (use `acp …` for the CLI; omit for the default stdio MCP server)
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

TARGET="${1:-}"
if [ -z "$TARGET" ] || [[ "$TARGET" == -* ]]; then
  echo "Usage: $0 user@host [--image tag] [--ssh-key path] [--port n] [--no-build] [--env-file path] [--run \"args\"]"
  exit 1
fi
shift

IMAGE="acp:latest"
SSH_KEY=""
SSH_PORT="22"
BUILD=true
ENV_FILE=""
RUN_ARGS=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --image) IMAGE="$2"; shift 2 ;;
    --ssh-key) SSH_KEY="$2"; shift 2 ;;
    --port) SSH_PORT="$2"; shift 2 ;;
    --no-build) BUILD=false; shift ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --run) RUN_ARGS="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

SSH_OPTS=(-p "$SSH_PORT")
SCP_OPTS=(-P "$SSH_PORT")
[ -n "$SSH_KEY" ] && { SSH_OPTS+=(-i "$SSH_KEY"); SCP_OPTS+=(-i "$SSH_KEY"); }

ssh_remote() { ssh "${SSH_OPTS[@]}" "$TARGET" "$@"; }

echo "==> Target: $TARGET (port $SSH_PORT)   Image: $IMAGE"

# 1. Build locally (unless skipped).
if [ "$BUILD" = true ]; then
  echo "==> Building $IMAGE locally..."
  docker build -t "$IMAGE" "$PROJECT_DIR"
else
  echo "==> Skipping build (--no-build); using existing local image $IMAGE"
fi

# 2. Sanity-check the remote has docker.
echo "==> Checking remote Docker..."
if ! ssh_remote "command -v docker >/dev/null 2>&1"; then
  echo "ERROR: 'docker' not found on $TARGET. Install Docker there first." >&2
  exit 1
fi

# 3. Stream the image over SSH (no registry).
echo "==> Shipping image (docker save | gzip | ssh | docker load)..."
docker save "$IMAGE" | gzip | ssh_remote "gunzip | docker load"

# 4. Verify it landed.
echo "==> Verifying image on remote..."
ssh_remote "docker image inspect '$IMAGE' --format 'loaded: {{.Id}}'"

# 5. Optionally copy the env file.
REMOTE_ENV=""
if [ -n "$ENV_FILE" ]; then
  [ -f "$ENV_FILE" ] || { echo "ERROR: env file not found: $ENV_FILE" >&2; exit 1; }
  REMOTE_ENV="\$HOME/acp.env"
  echo "==> Copying $ENV_FILE → $TARGET:~/acp.env"
  scp "${SCP_OPTS[@]}" "$ENV_FILE" "$TARGET:~/acp.env"
fi

# 6. Optionally run it.
if [ -n "$RUN_ARGS" ]; then
  ENVOPT=""
  [ -n "$REMOTE_ENV" ] && ENVOPT="--env-file $REMOTE_ENV"
  echo "==> Running on remote: docker run --rm $ENVOPT $IMAGE $RUN_ARGS"
  ssh_remote "docker run --rm $ENVOPT '$IMAGE' $RUN_ARGS"
fi

echo ""
echo "==> Done. On $TARGET you can now run:"
echo "    # CLI (one-shot), mount a dir to retrieve pulled folders:"
echo "    docker run --rm ${REMOTE_ENV:+--env-file ~/acp.env }-v \"\$PWD/out:/work/out\" $IMAGE acp pull-jira PROJ-1 /work/out"
echo "    # stdio MCP server (for an agent over: docker run -i):"
echo "    docker run -i --rm ${REMOTE_ENV:+--env-file ~/acp.env }$IMAGE"
