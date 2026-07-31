#!/usr/bin/env bash
# POSIX-shell compatibility wrapper. `npm run build:sand` works on every OS.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node wasm/build.mjs "$@"
