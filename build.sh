#!/bin/bash
set -e

echo "=== Installing pnpm ==="
npm install -g pnpm@10.26.1

echo "=== Installing dependencies ==="
pnpm install --no-frozen-lockfile

echo "=== Building frontend ==="
pnpm --filter @workspace/tahir-ai-writer run build

echo "=== Build complete ==="
echo "Output: artifacts/tahir-ai-writer/dist"
