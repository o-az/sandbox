# syntax=docker/dockerfile:1
FROM docker.io/cloudflare/sandbox:0.5.2

ENV TERM="xterm-256color"
ENV COLORTERM="truecolor"
ENV FOUNDRY_DISABLE_NIGHTLY_WARNING=1
ENV NODE_OPTIONS="npm_config_yes=true"

# Install build tools for node-pty native compilation
RUN apt-get update --yes \
  && apt-get install --yes --no-install-recommends \
  build-essential \
  python3 \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/foundry-rs/foundry:latest /usr/local/bin/anvil /usr/local/bin/anvil
COPY --from=ghcr.io/foundry-rs/foundry:latest /usr/local/bin/forge /usr/local/bin/forge
COPY --from=ghcr.io/foundry-rs/foundry:latest /usr/local/bin/cast /usr/local/bin/cast
COPY --from=ghcr.io/foundry-rs/foundry:latest /usr/local/bin/chisel /usr/local/bin/chisel

# Install node-pty, crossws, and uWebSockets.js for the PTY WebSocket server
RUN bun add --global node-pty@beta crossws uNetworking/uWebSockets.js

COPY scripts/websocket.ts scripts/startup.sh /container-server/scripts/
RUN chmod +x /container-server/scripts/startup.sh

ENV WS_PORT=8080

# Port 3000: Sandbox SDK control plane (required)
# Port 8080: WebSocket PTY server
# Port 6969: Additional services
EXPOSE 3000 ${WS_PORT} 6969

WORKDIR /container-server

CMD ["/container-server/scripts/startup.sh"]
