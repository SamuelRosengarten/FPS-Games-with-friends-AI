#!/bin/sh
# Breachpoint server launcher for Linux.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install Node 18+ (https://nodejs.org) and run this again."
  exit 1
fi
exec node server/index.js "$@"
