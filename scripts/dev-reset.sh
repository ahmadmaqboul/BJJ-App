#!/usr/bin/env bash
# Returns the local environment to a clean, freshly-seeded state.
#
#   ./scripts/dev-reset.sh
#
# The running dev server must be stopped first: miniflare keeps the SQLite file
# open, so a server started before the reset goes on serving the deleted
# database and you get stale data with no error to explain it.
#
# After this, start the server again (`npm run dev:server`) and the local admin
# login is 0599000001 / 24681357.

set -euo pipefail
cd "$(dirname "$0")/.."

# Match on a pattern that cannot match this script's own command line.
for pid in $(pgrep -f "wrangler-dist/cli[.]js" 2>/dev/null || true); do
  echo "stopping wrangler (pid $pid)"
  kill "$pid" 2>/dev/null || true
done
for pid in $(pgrep -f "npm exec wrangler de[v]" 2>/dev/null || true); do
  kill "$pid" 2>/dev/null || true
done
sleep 2

npm run db:reset:local

if [ -f scripts/phones.local.sql ]; then
  CI=1 npx wrangler d1 execute jui-jitsu-db --local --file scripts/phones.local.sql >/dev/null 2>&1
  echo "phone numbers applied from scripts/phones.local.sql"
else
  echo "no scripts/phones.local.sql — run 'npm run db:seed' with a phones.local.json to create it"
fi

echo
echo "Local database reset. Start the server with:  npm run dev:server"
