#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

load_env_file() {
  local env_file="$1"
  [[ -f "$env_file" ]] || return 0

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"

    # Skip blank lines and comments.
    [[ -z "${line//[[:space:]]/}" ]] && continue
    [[ "$line" =~ ^[[:space:]]*# ]] && continue

    # Parse KEY=VALUE without evaluating shell expressions/pipes.
    if [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      local key="${BASH_REMATCH[1]}"
      local value="${BASH_REMATCH[2]}"

      # Trim leading spaces on value.
      value="${value#"${value%%[![:space:]]*}"}"

      # Remove matching single or double quotes around the full value.
      if [[ "$value" =~ ^\"(.*)\"$ ]]; then
        value="${BASH_REMATCH[1]}"
      elif [[ "$value" =~ ^\'(.*)\'$ ]]; then
        value="${BASH_REMATCH[1]}"
      fi

      export "$key=$value"
    fi
  done < "$env_file"
}

load_env_file ".env"

export OBS_PROXY_VIA_FEBRUARY11="${OBS_PROXY_VIA_FEBRUARY11:-true}"
export FEBRUARY11_API_BASE_URL="${FEBRUARY11_API_BASE_URL:-http://127.0.0.1:3199}"
export OVERLAYS_SERVER_PORT="${OVERLAYS_SERVER_PORT:-5555}"

cd OBS-Overlays
if [[ ! -x "./venv/bin/python" ]] || ! ./venv/bin/python -c "import sys" >/dev/null 2>&1; then
  echo "OBS-Overlays virtual environment is missing or invalid. Rebuilding..."
  ./setup.sh
fi
exec ./venv/bin/python server.py
