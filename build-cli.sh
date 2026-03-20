#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/packages/cli"
bun run build
bun build --compile src/index.ts --outfile ../../headrss
echo "Built: ./headrss"
