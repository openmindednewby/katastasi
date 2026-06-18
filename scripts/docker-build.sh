#!/usr/bin/env bash
# ============================================================================
# Build the ai-confluence-pipeline Docker image locally.
#
# Usage:
#   ./scripts/docker-build.sh                 # builds acp:latest
#   ./scripts/docker-build.sh myreg/acp:1.0   # custom tag
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE="${1:-acp:latest}"

echo "Building $IMAGE from $PROJECT_DIR ..."
docker build -t "$IMAGE" "$PROJECT_DIR"
echo "Done: $IMAGE"
docker image inspect "$IMAGE" --format '  size: {{.Size}} bytes, created: {{.Created}}'
