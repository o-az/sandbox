# syntax=docker/dockerfile:1

FROM oven/bun:1-debian AS builder

USER root

# node-pty native compilation
RUN apt-get update --yes \
  && apt-get install --yes --no-install-recommends build-essential python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY ./websocket.ts ./websocket.ts

RUN echo '{ "type": "module" }' > package.json \
  && bun add --production node-pty@beta crossws \
  && bun build ./websocket.ts \
    --outfile='./websocket.js' \
    --format='esm' \
    --target='node' \
    --external='node-pty' \
    --minify

FROM docker.io/cloudflare/sandbox:0.5.4 AS runtime

ENV CLICOLOR=1
ENV FORCE_COLOR=3
ENV TERM="xterm-256color"
ENV COLORTERM="truecolor"
ENV FOUNDRY_DISABLE_NIGHTLY_WARNING=1
ENV NODE_OPTIONS="npm_config_yes=true"
ENV WS_PORT=8080

COPY --from=ghcr.io/foundry-rs/foundry:latest /usr/local/bin/cast /usr/local/bin/cast
COPY --from=ghcr.io/foundry-rs/foundry:latest /usr/local/bin/anvil /usr/local/bin/anvil
COPY --from=ghcr.io/foundry-rs/foundry:latest /usr/local/bin/forge /usr/local/bin/forge
COPY --from=ghcr.io/foundry-rs/foundry:latest /usr/local/bin/chisel /usr/local/bin/chisel

# Node.js LTS
COPY --from=node:lts-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:lts-bookworm-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
  && ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

COPY --from=builder /usr/src/app/websocket.js /container-server/pty/websocket.js
COPY --from=builder /usr/src/app/node_modules/node-pty /container-server/pty/node_modules/node-pty
COPY ./scripts/startup.sh /container-server/pty/startup.sh

RUN chmod +x /container-server/pty/startup.sh

EXPOSE 3000 ${WS_PORT} 6969

WORKDIR /container-server

CMD ["/container-server/pty/startup.sh"]
