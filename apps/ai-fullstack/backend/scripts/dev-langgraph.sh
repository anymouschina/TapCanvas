#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

: "${HOST:=127.0.0.1}"
# Avoid relying on generic `PORT` which may be set by other tooling/shells.
: "${LANGGRAPH_HOST:=$HOST}"
: "${LANGGRAPH_PORT:=8123}"

exec ./.venv/bin/langgraph dev --no-browser --host "$LANGGRAPH_HOST" --port "$LANGGRAPH_PORT"
