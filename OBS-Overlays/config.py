"""
=== STREAM AUTOMATION CONFIG ===
Fill in your credentials below. Everything else has sane defaults.
"""
import os


def _read_bool(name, fallback):
    raw = os.getenv(name)
    if raw is None:
        return fallback
    normalized = raw.strip().lower()
    if normalized in ("1", "true", "yes", "on"):
        return True
    if normalized in ("0", "false", "no", "off"):
        return False
    return fallback


def _read_int(name, fallback):
    raw = os.getenv(name)
    if raw is None:
        return fallback
    try:
        return int(raw)
    except Exception:
        return fallback


def _read_float(name, fallback):
    raw = os.getenv(name)
    if raw is None:
        return fallback
    try:
        return float(raw)
    except Exception:
        return fallback

# ──────────────────────────────────────────────
# TWITCH SETTINGS
# ──────────────────────────────────────────────
# 1. Go to https://dev.twitch.tv/console/apps
# 2. Create a new application
# 3. Set redirect URL to http://localhost:5000/auth/callback
# 4. Copy Client ID and Client Secret here

TWITCH_CLIENT_ID = os.getenv("TWITCH_CLIENT_ID", "YOUR_CLIENT_ID")
TWITCH_CLIENT_SECRET = os.getenv("TWITCH_CLIENT_SECRET", "YOUR_CLIENT_SECRET")

# Generate an OAuth token at https://twitchtokengenerator.com/
# Select "Bot Chat Token" - needs chat:read, chat:edit scopes
TWITCH_OAUTH_TOKEN = os.getenv("TWITCH_OAUTH_TOKEN", "oauth:YOUR_OAUTH_TOKEN")

# Your Twitch channel name (lowercase)
TWITCH_CHANNEL = os.getenv("TWITCH_CHANNEL", "YOUR_CHANNEL_NAME")

# Bot username (can be same as your channel name)
TWITCH_BOT_NAME = os.getenv("TWITCH_BOT_NAME", "YOUR_BOT_NAME")

# ──────────────────────────────────────────────
# OBS WEBSOCKET SETTINGS
# ──────────────────────────────────────────────
OBS_HOST = os.getenv("OBS_HOST", "localhost")
OBS_PORT = _read_int("OBS_PORT", 4455)
OBS_PASSWORD = os.getenv("OBS_PASSWORD", "")  # Set this if you enabled auth in OBS websocket settings

# ──────────────────────────────────────────────
# SERVER SETTINGS
# ──────────────────────────────────────────────
SERVER_HOST = os.getenv("OVERLAYS_SERVER_HOST", "0.0.0.0")  # Listen on all interfaces
SERVER_PORT = _read_int("OVERLAYS_SERVER_PORT", 5555)  # 5000 is used by AirPlay on macOS
SECRET_KEY = os.getenv("OVERLAYS_SECRET_KEY", "change-this-to-something-random")

# Keyboard capture (global key events for keyboard overlay)
KEYBOARD_CAPTURE_ENABLED = _read_bool("OVERLAYS_KEYBOARD_CAPTURE_ENABLED", True)

# Optional fallback: use FEBRUARY11 OBS endpoints when direct OBS connection fails.
OBS_PROXY_VIA_FEBRUARY11 = _read_bool("OBS_PROXY_VIA_FEBRUARY11", True)
FEBRUARY11_API_BASE_URL = os.getenv("FEBRUARY11_API_BASE_URL", "http://127.0.0.1:3199")

# ──────────────────────────────────────────────
# ALERT SETTINGS
# ──────────────────────────────────────────────
# Duration alerts stay on screen (milliseconds)
ALERT_DURATION = 5000

# Alert sound files (place .mp3/.wav in static/sounds/)
FOLLOW_SOUND = "/static/sounds/follow.mp3"
SUB_SOUND = "/static/sounds/sub.mp3"
RAID_SOUND = "/static/sounds/raid.mp3"
BITS_SOUND = "/static/sounds/bits.mp3"
DONATION_SOUND = "/static/sounds/donation.mp3"

# ──────────────────────────────────────────────
# CHAT OVERLAY SETTINGS
# ──────────────────────────────────────────────
# Max messages shown in chat overlay
CHAT_MAX_MESSAGES = 25

# Chat commands prefix
COMMAND_PREFIX = "!"

# ──────────────────────────────────────────────
# AUTO-CLIP SETTINGS
# ──────────────────────────────────────────────
# When this many messages arrive within CLIP_WINDOW seconds, create a clip
CLIP_SPAM_THRESHOLD = 15
CLIP_WINDOW_SECONDS = 10
CLIP_TRIGGER_WORDS = ["CLIP", "clip", "POGGERS", "POG", "LUL", "LMAO", "OMEGALUL"]

# ──────────────────────────────────────────────
# THEME / COLORS (CSS variables passed to overlays)
# ──────────────────────────────────────────────
THEME = {
    "primary": "#9147ff",       # Twitch purple
    "secondary": "#00f0ff",     # Cyan accent
    "background": "transparent",
    "text": "#ffffff",
    "chat_bg": "rgba(0, 0, 0, 0.6)",
    "alert_bg": "rgba(0, 0, 0, 0.85)",
    "font": "'Inter', 'Segoe UI', sans-serif",
}

# Subtitles overlay defaults (can be updated live via dashboard/API)
SUBTITLE_DEFAULT_FONT_FAMILY = os.getenv("SUBTITLE_DEFAULT_FONT_FAMILY", "Inter, Segoe UI, sans-serif")
SUBTITLE_DEFAULT_FONT_SIZE = _read_int("SUBTITLE_DEFAULT_FONT_SIZE", 56)
SUBTITLE_DEFAULT_TEXT_COLOR = os.getenv("SUBTITLE_DEFAULT_TEXT_COLOR", "#ffffff")
SUBTITLE_DEFAULT_BG_COLOR = os.getenv("SUBTITLE_DEFAULT_BG_COLOR", "#000000")
SUBTITLE_DEFAULT_BG_OPACITY = _read_float("SUBTITLE_DEFAULT_BG_OPACITY", 0.45)
