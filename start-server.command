#!/bin/bash
# Breachpoint server launcher for macOS - double-click me (first time: right-click > Open).
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  for p in /opt/homebrew/bin /usr/local/bin; do [ -x "$p/node" ] && export PATH="$p:$PATH"; done
fi
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node.js is not installed."
  echo "  Install the LTS version from https://nodejs.org and double-click this file again."
  echo ""
  open "https://nodejs.org/en/download"
  read -n 1 -s -r -p "  Press any key to close..."
  exit 1
fi
node server/index.js "$@"
echo ""
read -n 1 -s -r -p "  Server stopped. Press any key to close..."
