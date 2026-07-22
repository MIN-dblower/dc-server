#!/usr/bin/env bash
#
# Launches Chrome with the custom profile and remote debugging port required
# by the DC sync worker (see docs/SETUP.md, section "Chrome Browser Setup").
#
# Env overrides:
#   CHROME_PROFILE_DIR  default: <project_root>/.chrome-profile-dc
#   CHROME_DEBUG_PORT   default: 19203
#   CHROME_BIN          default: auto-detected google-chrome binary

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

PROFILE_DIR="${CHROME_PROFILE_DIR:-$PROJECT_ROOT/.chrome-profile-dc}"
DEBUG_PORT="${CHROME_DEBUG_PORT:-19203}"

if [ -n "${CHROME_BIN:-}" ]; then
  BIN="$CHROME_BIN"
elif command -v google-chrome >/dev/null 2>&1; then
  BIN="google-chrome"
elif command -v google-chrome-stable >/dev/null 2>&1; then
  BIN="google-chrome-stable"
elif [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
  BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
else
  echo "Could not find a Chrome binary. Set CHROME_BIN to its path." >&2
  exit 1
fi

mkdir -p "$PROFILE_DIR"

echo "Starting Chrome (profile: $PROFILE_DIR, debug port: $DEBUG_PORT)..."
exec "$BIN" --user-data-dir="$PROFILE_DIR" --remote-debugging-port="$DEBUG_PORT"
