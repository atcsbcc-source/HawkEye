#!/bin/bash
# HawkEye — double-click launcher for macOS.
#
# Builds the dashboard once (if needed), starts the production server on
# http://localhost:3000 and opens it in your default browser. Uses
# dashboard/.env.local when present (Supabase mode); otherwise runs in
# DEV MODE on mock data. Close this Terminal window to stop the server.
#
# First time: right-click the file → Open (Gatekeeper), or run
#   chmod +x scripts/hawkeye.command
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-3000}"
if [ ! -d node_modules ]; then
  echo "Installing dependencies…"; npm ci
fi
if [ ! -d .next ] || [ -n "$(find app lib components -newer .next -name '*.ts*' -print -quit 2>/dev/null)" ]; then
  echo "Building HawkEye…"; NEXT_TELEMETRY_DISABLED=1 npm run build
fi
if [ ! -f .env.local ]; then
  export HAWKEYE_ALLOW_DEV_MODE=1
  echo "No .env.local — starting in DEV MODE (mock data, no sign-in)."
fi

( sleep 3 && open "http://localhost:${PORT}" ) &
echo "HawkEye → http://localhost:${PORT}   (close this window to stop)"
exec npm run start -- -p "${PORT}"
