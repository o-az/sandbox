# syntax=docker/dockerfile:1
FROM docker.io/cloudflare/sandbox:0.4.17

ENV FOUNDRY_DISABLE_NIGHTLY_WARNING=1
ENV NODE_OPTIONS="npm_config_yes=true"

# Install a lightweight vi implementation for interactive debugging inside the sandbox
RUN apt-get update \
  && apt-get install -y --no-install-recommends vim-tiny \
  && rm -rf /var/lib/apt/lists/*

RUN npm install --global \
  @foundry-rs/cast@nightly \
  @foundry-rs/forge@nightly \
  @foundry-rs/anvil@nightly \
  @foundry-rs/chisel@nightly

COPY scripts/websocket-server.ts websocket-server.ts
COPY scripts/startup.sh startup.sh
RUN chmod +x startup.sh

ENV WS_PORT=8080

# Expose the primary shell port (8080) and the legacy 6969 fallback for local dev
EXPOSE 8080 6969
