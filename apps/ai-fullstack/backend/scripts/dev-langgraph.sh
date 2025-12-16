#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

: "${HOST:=127.0.0.1}"
: "${PORT:=8001}"

exec ./.venv/bin/langgraph dev --no-browser --host "$HOST" --port "$PORT"

