# syntax=docker/dockerfile:1

FROM oven/bun:1-debian AS builder

# Switch to root for consistent paths (oven/bun defaults to 'bun' user)
USER root

# Install build tools for node-pty native compilation
RUN apt-get update --yes \
  && apt-get install --yes --no-install-recommends \
  build-essential \
  python3 \
  && rm -rf /var/lib/apt/lists/*

# Install native dependencies that require compilation
# node-pty is a native addon - compilation can take 2-5 min on arm64
RUN bun add --global node-pty@beta crossws uNetworking/uWebSockets.js

# Clean up unnecessary files from node-pty to reduce image size
# Removes: Windows deps (winpty, conpty), macOS prebuilds, source files, tests, docs
RUN cd /root/.bun/install/global/node_modules/node-pty \
  && rm -rf \
  deps/winpty \
  third_party \
  prebuilds/win32-* \
  prebuilds/darwin-* \
  src/*.ts src/*.cc src/*.h \
  src/**/*.ts src/**/*.cc src/**/*.h \
  scripts \
  *.md \
  lib/*.test.js lib/*.test.js.map \
  typings \
  && find . -name "*.pdb" -delete \
  && find . -name "*.gyp" -delete \
  && find . -name "*.gypi" -delete \
  && echo "Cleaned node-pty: $(du -sh . | cut -f1)"

FROM docker.io/cloudflare/sandbox:0.5.3 AS runtime

# Environment configuration
ENV TERM="xterm-256color"
ENV COLORTERM="truecolor"
ENV FOUNDRY_DISABLE_NIGHTLY_WARNING=1
ENV NODE_OPTIONS="npm_config_yes=true"
ENV WS_PORT=8080

# Copy pre-compiled bun global packages from builder (already cleaned)
COPY --from=builder /root/.bun/install/global /root/.bun/install/global

# Copy Foundry CLI tools (already compiled binaries)
COPY --from=ghcr.io/foundry-rs/foundry:latest /usr/local/bin/anvil /usr/local/bin/anvil
COPY --from=ghcr.io/foundry-rs/foundry:latest /usr/local/bin/forge /usr/local/bin/forge
COPY --from=ghcr.io/foundry-rs/foundry:latest /usr/local/bin/cast /usr/local/bin/cast
COPY --from=ghcr.io/foundry-rs/foundry:latest /usr/local/bin/chisel /usr/local/bin/chisel

# Copy application scripts
COPY scripts/websocket.ts scripts/startup.sh /container-server/scripts/
RUN chmod +x /container-server/scripts/startup.sh

# Port 3000: Sandbox SDK control plane (required)
# Port 8080: WebSocket PTY server
# Port 6969: Additional services
EXPOSE 3000 ${WS_PORT} 6969

WORKDIR /container-server

CMD ["/container-server/scripts/startup.sh"]
