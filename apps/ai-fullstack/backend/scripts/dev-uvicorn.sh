#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

: "${HOST:=127.0.0.1}"
: "${PORT:=8080}"

exec ./.venv/bin/python -m uvicorn agent.app:app --host "$HOST" --port "$PORT" --reload

