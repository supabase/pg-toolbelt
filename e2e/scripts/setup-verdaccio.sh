#!/usr/bin/env bash
# Start a local verdaccio npm registry in Docker for e2e tests.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
E2E_DIR="$(dirname "$SCRIPT_DIR")"
CONTAINER_NAME="pg-toolbelt-verdaccio"
VERDACCIO_URL="http://localhost:4873"

# Stop any existing container
docker rm -f "$CONTAINER_NAME" 2>/dev/null || true

echo "Starting verdaccio on $VERDACCIO_URL..."
docker run -d \
  --name "$CONTAINER_NAME" \
  --network host \
  -v "$E2E_DIR/verdaccio/config.yaml:/verdaccio/conf/config.yaml:ro" \
  verdaccio/verdaccio:6

# Wait for verdaccio to be ready
echo "Waiting for verdaccio..."
for i in $(seq 1 30); do
  if curl -sf "$VERDACCIO_URL/-/ping" >/dev/null 2>&1; then
    echo "Verdaccio is ready."
    exit 0
  fi
  sleep 1
done

echo "ERROR: Verdaccio did not start within 30s"
docker logs "$CONTAINER_NAME"
exit 1
