# syntax=docker/dockerfile:1
FROM oven/bun:1-debian AS builder

USER root

# node-pty native compilation
RUN apt-get update --yes \
  && apt-get install --yes --no-install-recommends build-essential python3 \
  && apt-get clean --yes \
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

FROM docker.io/cloudflare/sandbox:0.7.0 AS runtime

ENV CLICOLOR=1
ENV WS_PORT=8080
ENV FORCE_COLOR=3
ENV TERM="xterm-256color"
ENV COLORTERM="truecolor"
ENV FOUNDRY_DISABLE_NIGHTLY_WARNING=1
ENV NODE_OPTIONS="npm_config_yes=true"
ENV PATH="/root/.local/bin:/root/.foundry/bin:${PATH}"

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Foundry + uv + minimal tools (single layer, no build-essential)
RUN curl --silent --show-error --location https://foundry.paradigm.xyz | bash \
  && foundryup --network tempo \
  && curl --silent --show-error --location https://astral.sh/uv/install.sh | sh \
  && apt-get update --yes \
  && apt-get install --yes --no-install-recommends \
  build-essential \
  vim-tiny \
  git \
  jq \
  && apt-get clean --yes \
  && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

COPY --from=builder /usr/src/app/websocket.js /container-server/pty/websocket.js
COPY --from=builder /usr/src/app/node_modules/node-pty /container-server/pty/node_modules/node-pty
COPY ./scripts/startup.sh /container-server/pty/startup.sh

RUN chmod +x /container-server/pty/startup.sh

EXPOSE 3000 ${WS_PORT} 6969

RUN mkdir -p /workspace

WORKDIR /container-server

CMD ["/container-server/pty/startup.sh"]
