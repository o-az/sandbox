#!/usr/bin/env bash

set -euo pipefail

: "${WS_PORT:=8080}"
export WS_PORT

echo "[startup] launching WebSocket PTY server (node-pty) on port ${WS_PORT}..."
bun /container-server/scripts/websocket.ts &

echo "[startup] starting Cloudflare Sandbox control plane..."

exec bun /container-server/dist/index.js
