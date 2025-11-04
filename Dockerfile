# syntax=docker/dockerfile:1
FROM docker.io/cloudflare/sandbox:0.4.15

ENV FOUNDRY_DISABLE_NIGHTLY_WARNING=1
ENV NODE_OPTIONS="npm_config_yes=true"

RUN npm add --global \
  @foundry-rs/cast@nightly \
  @foundry-rs/forge@nightly \
  @foundry-rs/anvil@nightly \
  @foundry-rs/chisel@nightly

# Expose any ports you might want to use (optional)
# EXPOSE 3000 8080
