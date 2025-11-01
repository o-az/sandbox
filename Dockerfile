# syntax=docker/dockerfile:1
FROM docker.io/cloudflare/sandbox:0.4.14

ENV FOUNDRY_DISABLE_NIGHTLY_WARNING=1

RUN npm add --global @foundry-rs/cast@nightly && \
  npm add --global @foundry-rs/forge@nightly && \
  npm add --global @foundry-rs/anvil@nightly && \
  npm add --global @foundry-rs/chisel@nightly

# Expose any ports you might want to use (optional)
# EXPOSE 3000 8080
