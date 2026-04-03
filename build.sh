#!/bin/bash
set -e

echo "=== Installing pnpm ==="
npm install -g pnpm@10.26.1

echo "=== Installing dependencies ==="
pnpm install --no-frozen-lockfile

echo "=== Building frontend ==="
# Set required env vars for Vite build
export PORT=3000
export BASE_PATH=/
export NODE_ENV=production
# VITE_API_URL: URL of the backend API server (update this when you deploy the API)
export VITE_API_URL="${VITE_API_URL:-https://1dbb542e-16d6-4d17-b4fe-744ddf429624-00-3gn46t45bd1ap.spock.replit.dev}"

pnpm --filter @workspace/tahir-ai-writer run build

echo "=== Copying dist to root dist/ ==="
rm -rf dist
mkdir -p dist
cp -r artifacts/tahir-ai-writer/dist/public/. dist/

echo "=== Writing .htaccess for SPA routing ==="
cat > dist/.htaccess << 'EOF'
Options -MultiViews
RewriteEngine On
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^ index.html [QSA,L]
EOF

echo "=== Build complete — serve from: dist/ ==="
