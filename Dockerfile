# syntax=docker/dockerfile:1

FROM oven/bun:1-debian AS builder

USER root

# node-pty native compilation
RUN apt-get update --yes \
  && apt-get install --yes --no-install-recommends \
  build-essential \
  python3 \
  && rm -rf /var/lib/apt/lists/*

RUN bun add --global node-pty@beta crossws uNetworking/uWebSockets.js

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

ENV FORCE_COLOR=3
ENV TERM="xterm-256color"
ENV COLORTERM="truecolor"
ENV FOUNDRY_DISABLE_NIGHTLY_WARNING=1
ENV NODE_OPTIONS="npm_config_yes=true"
ENV WS_PORT=8080

COPY --from=builder /root/.bun/install/global /root/.bun/install/global

COPY --from=ghcr.io/foundry-rs/foundry:latest /usr/local/bin/anvil /usr/local/bin/anvil
COPY --from=ghcr.io/foundry-rs/foundry:latest /usr/local/bin/forge /usr/local/bin/forge
COPY --from=ghcr.io/foundry-rs/foundry:latest /usr/local/bin/cast /usr/local/bin/cast
COPY --from=ghcr.io/foundry-rs/foundry:latest /usr/local/bin/chisel /usr/local/bin/chisel

COPY scripts/websocket.ts scripts/startup.sh /container-server/scripts/
RUN chmod +x /container-server/scripts/startup.sh

# 3000: Sandbox SDK control plane (required)
# 8080: WebSocket PTY server
# 6969: Additional services
EXPOSE 3000 ${WS_PORT} 6969

WORKDIR /container-server

CMD ["/container-server/scripts/startup.sh"]
