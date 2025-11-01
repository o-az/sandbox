#!/usr/bin/env bash

set -euo pipefail

bun /workspace/src/client.tsx &

exec bun dist/index.js