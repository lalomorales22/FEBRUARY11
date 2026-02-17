#!/bin/bash
# === STREAM AUTOMATION SETUP ===
# Run this once: bash setup.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

VENV_DIR="$ROOT_DIR/venv"
VENV_PYTHON="$VENV_DIR/bin/python"

venv_is_usable() {
    if [[ ! -x "$VENV_PYTHON" ]]; then
        return 1
    fi
    "$VENV_PYTHON" -c "import sys; print(sys.version)" >/dev/null 2>&1
}

echo "=================================="
echo "  Stream Automation Setup"
echo "=================================="
echo ""

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "ERROR: Python 3 not found. Install it first."
    exit 1
fi

echo "[1/3] Creating virtual environment..."
if [[ -d "$VENV_DIR" ]] && ! venv_is_usable; then
    echo "Existing virtual environment is invalid (likely moved folder). Recreating..."
    rm -rf "$VENV_DIR"
fi

if [[ ! -d "$VENV_DIR" ]]; then
    python3 -m venv "$VENV_DIR"
fi

echo "[2/3] Installing dependencies..."
"$VENV_PYTHON" -m pip install --upgrade pip
"$VENV_PYTHON" -m pip install -r requirements.txt

echo "[3/3] Creating placeholder sound files..."
# Create empty sound files so the server doesn't error
# Replace these with actual .mp3/.wav files for real alerts
touch static/sounds/follow.mp3
touch static/sounds/sub.mp3
touch static/sounds/raid.mp3

echo ""
echo "=================================="
echo "  Setup Complete!"
echo "=================================="
echo ""
echo "NEXT STEPS:"
echo ""
echo "  1. Edit config.py with your Twitch credentials:"
echo "     - TWITCH_CLIENT_ID"
echo "     - TWITCH_CLIENT_SECRET"
echo "     - TWITCH_OAUTH_TOKEN  (get from twitchtokengenerator.com)"
echo "     - TWITCH_CHANNEL"
echo ""
echo "  2. Make sure OBS is running with WebSocket enabled (port 4455)"
echo ""
echo "  3. Start the server:"
echo "     ./venv/bin/python server.py"
echo ""
echo "  4. Add Browser Sources in OBS:"
echo "     - Alerts:  http://localhost:5555/overlay/alerts   (800x600)"
echo "     - Chat:    http://localhost:5555/overlay/chat     (400x600)"
echo "     - Stats:   http://localhost:5555/overlay/stats    (600x80)"
echo ""
echo "  5. Open dashboard in your browser:"
echo "     http://localhost:5555/dashboard"
echo ""
echo "  You can test alerts from the dashboard WITHOUT"
echo "  Twitch credentials - just start the server!"
echo ""
