#!/usr/bin/env python3
"""
=== TWITCH STREAM AUTOMATION SERVER ===
Custom streaming overlay + automation system.

Run:  python server.py
Then point OBS browser sources to:
  - http://localhost:5000/overlay/alerts
  - http://localhost:5000/overlay/chat
  - http://localhost:5000/overlay/stats
  - http://localhost:5000/dashboard  (control panel in your browser)
"""

import os
import sys
import time
import json
import re
import sqlite3
import threading
import logging
from datetime import datetime, timedelta
from collections import deque

from flask import Flask, render_template, jsonify, request
from flask_socketio import SocketIO
import requests as http_requests

import config

# ──────────────────────────────────────────────
# LOGGING
# ──────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("stream")

# ──────────────────────────────────────────────
# FLASK + SOCKETIO SETUP
# ──────────────────────────────────────────────
app = Flask(__name__)
app.config["SECRET_KEY"] = config.SECRET_KEY
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

# ──────────────────────────────────────────────
# DATABASE SETUP (SQLite for stats tracking)
# ──────────────────────────────────────────────
DB_PATH = os.path.join(os.path.dirname(__file__), "stream_data.db")


def init_db():
    """Create tables if they don't exist."""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT NOT NULL,
            username TEXT,
            data TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS stream_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            ended_at TIMESTAMP,
            followers_gained INTEGER DEFAULT 0,
            subs_gained INTEGER DEFAULT 0,
            raids_received INTEGER DEFAULT 0,
            peak_viewers INTEGER DEFAULT 0,
            total_messages INTEGER DEFAULT 0
        )
    """)
    conn.commit()
    conn.close()
    log.info("Database initialized")


def log_event(event_type, username="", data=""):
    """Log an event to the database."""
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute(
            "INSERT INTO events (event_type, username, data) VALUES (?, ?, ?)",
            (event_type, username, json.dumps(data) if isinstance(data, dict) else str(data)),
        )
        conn.commit()
        conn.close()
    except Exception as e:
        log.error(f"DB error: {e}")


# ──────────────────────────────────────────────
# IN-MEMORY STATE
# ──────────────────────────────────────────────
stream_stats = {
    "followers_this_stream": 0,
    "subs_this_stream": 0,
    "raids_this_stream": 0,
    "viewers": 0,
    "total_messages": 0,
    "stream_start": None,
}

# Ring buffer for recent chat messages (for auto-clip detection)
recent_messages = deque(maxlen=200)

# Track message timestamps for clip detection
clip_message_times = deque(maxlen=100)
last_clip_time = 0  # Prevent clip spam

HEX_COLOR_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")

subtitle_state_lock = threading.Lock()
subtitle_state = {
    "text": "",
    "final": True,
    "updated_at": None,
}
subtitle_settings = {
    "font_family": "Inter, Segoe UI, sans-serif",
    "font_size_px": 56,
    "text_color": "#ffffff",
    "background_color": "#000000",
    "background_opacity": 0.45,
    "updated_at": None,
}

avatar_settings_lock = threading.Lock()
avatar_settings = {
    "vrmPath": "/static/VRMs/lalo.vrm",
    "webcamEnabled": True,
    "idleBreathingSpeed": 1.2,
    "idleSwayAmount": 0.008,
    "autoLookAround": True,
    "blinkInterval": 3500,
    "lerpAmount": 0.6,
    "lerpAmountFace": 0.7,
    "cameraPosition": {"x": 0, "y": 1.35, "z": 3.5},
    "cameraLookAt": {"x": 0, "y": 1.2, "z": 0},
    "updated_at": None,
}

# ──────────────────────────────────────────────
# SOUND BOARD STATE
# ──────────────────────────────────────────────
soundboard_lock = threading.Lock()
soundboard_sounds = {}  # Populated from static/sounds/soundboard/ at startup
soundboard_cooldowns = {}  # Track per-sound cooldowns
SOUNDBOARD_COOLDOWN_SEC = 5  # Min seconds between same sound trigger


def init_soundboard():
    """Scan static/sounds/soundboard/ for sound files and build the sound map."""
    sb_dir = os.path.join(os.path.dirname(__file__), "static", "sounds", "soundboard")
    if not os.path.isdir(sb_dir):
        os.makedirs(sb_dir, exist_ok=True)
        log.info(f"Created soundboard directory: {sb_dir}")
    for f in os.listdir(sb_dir):
        if f.lower().endswith((".mp3", ".wav", ".ogg", ".webm")):
            name = os.path.splitext(f)[0]
            slug = name.lower().replace(" ", "-").replace("_", "-")
            soundboard_sounds[slug] = {
                "name": name.replace("-", " ").replace("_", " ").title(),
                "slug": slug,
                "file": f"/static/sounds/soundboard/{f}",
                "icon": "🔊",
                "volume": 0.7,
                "chatCommand": slug,
            }
    log.info(f"Sound board loaded: {len(soundboard_sounds)} sounds")


def play_sound(slug, triggered_by="Dashboard"):
    """Play a soundboard sound and emit to overlays."""
    with soundboard_lock:
        sound = soundboard_sounds.get(slug)
        if not sound:
            return None
        now = time.time()
        last_played = soundboard_cooldowns.get(slug, 0)
        if now - last_played < SOUNDBOARD_COOLDOWN_SEC:
            return None
        soundboard_cooldowns[slug] = now

    payload = {
        "name": sound["name"],
        "slug": sound["slug"],
        "file": sound["file"],
        "icon": sound["icon"],
        "volume": sound["volume"],
        "triggeredBy": triggered_by,
        "showOverlay": True,
        "displayDuration": 3000,
    }
    socketio.emit("soundboard_play", payload)
    log_event("soundboard", triggered_by, {"sound": slug})
    log.info(f"Sound board: {sound['name']} (triggered by {triggered_by})")
    return payload


# ──────────────────────────────────────────────
# GOAL TRACKER STATE
# ──────────────────────────────────────────────
goals_lock = threading.Lock()
stream_goals = [
    {"id": "followers", "type": "followers", "title": "Follower Goal", "current": 0, "target": 50, "enabled": True},
    {"id": "subs", "type": "subs", "title": "Sub Goal", "current": 0, "target": 10, "enabled": True},
    {"id": "donations", "type": "donations", "title": "Donation Goal", "current": 0, "target": 100, "enabled": False},
    {"id": "bits", "type": "bits", "title": "Bits Goal", "current": 0, "target": 5000, "enabled": False},
]


def get_goals():
    with goals_lock:
        return [dict(g) for g in stream_goals]


def update_goal(goal_id, data):
    with goals_lock:
        for g in stream_goals:
            if g["id"] == goal_id:
                if "current" in data:
                    g["current"] = int(data["current"])
                if "target" in data:
                    g["target"] = max(1, int(data["target"]))
                if "title" in data:
                    g["title"] = str(data["title"])[:60]
                if "enabled" in data:
                    g["enabled"] = bool(data["enabled"])
                snapshot = get_goals()
                socketio.emit("goals_update", {"goals": snapshot})
                return g
    return None


def increment_goal(goal_id, amount=1):
    with goals_lock:
        for g in stream_goals:
            if g["id"] == goal_id:
                g["current"] += amount
                snapshot = get_goals()
    socketio.emit("goals_update", {"goals": get_goals()})


# ──────────────────────────────────────────────
# CHAOS PRESETS
# ──────────────────────────────────────────────
chaos_lock = threading.Lock()
chaos_cooldown = {}
CHAOS_COOLDOWN_SEC = 15  # Global cooldown between chaos triggers

CHAOS_PRESETS = {
    "disco": {
        "name": "Disco Mode",
        "icon": "🪩",
        "duration": 8000,
        "effect": "disco",
        "description": "Flashing rainbow lights!",
    },
    "earthquake": {
        "name": "Earthquake",
        "icon": "🌋",
        "duration": 5000,
        "effect": "shake",
        "description": "Screen shake chaos!",
    },
    "confetti": {
        "name": "Confetti",
        "icon": "🎉",
        "duration": 6000,
        "effect": "confetti",
        "description": "Party confetti explosion!",
    },
    "matrix": {
        "name": "Matrix Rain",
        "icon": "💊",
        "duration": 8000,
        "effect": "matrix",
        "description": "Digital rain effect!",
    },
    "rave": {
        "name": "Rave Mode",
        "icon": "🔊",
        "duration": 10000,
        "effect": "rave",
        "description": "Strobing neon lights + bass!",
    },
    "glitch": {
        "name": "Glitch",
        "icon": "📺",
        "duration": 4000,
        "effect": "glitch",
        "description": "VHS glitch distortion!",
    },
    "hearts": {
        "name": "Heart Rain",
        "icon": "❤️",
        "duration": 6000,
        "effect": "hearts",
        "description": "Falling hearts everywhere!",
    },
    "jumpscare": {
        "name": "Jumpscare",
        "icon": "👻",
        "duration": 2000,
        "effect": "jumpscare",
        "description": "A spooky surprise!",
    },
}


def trigger_chaos(preset_slug, triggered_by="Dashboard"):
    """Trigger a chaos effect and broadcast to overlays."""
    with chaos_lock:
        preset = CHAOS_PRESETS.get(preset_slug)
        if not preset:
            return None
        now = time.time()
        last = chaos_cooldown.get("_global", 0)
        if now - last < CHAOS_COOLDOWN_SEC:
            return None
        chaos_cooldown["_global"] = now

    payload = {
        "slug": preset_slug,
        "name": preset["name"],
        "icon": preset["icon"],
        "effect": preset["effect"],
        "duration": preset["duration"],
        "description": preset["description"],
        "triggeredBy": triggered_by,
    }
    socketio.emit("chaos_trigger", payload)
    log_event("chaos", triggered_by, {"preset": preset_slug})
    log.info(f"Chaos: {preset['name']} (triggered by {triggered_by})")
    return payload


keyboard_state_lock = threading.Lock()
pressed_keyboard_keys = set()
keyboard_capture_listener = None
keyboard_capture_status = {
    "enabled": bool(getattr(config, "KEYBOARD_CAPTURE_ENABLED", True)),
    "available": False,
    "active": False,
    "last_error": None,
    "updated_at": None,
}


def now_iso():
    return datetime.utcnow().isoformat() + "Z"


def clamp(value, low, high):
    return max(low, min(high, value))


def sanitize_hex_color(value, fallback):
    if isinstance(value, str):
        candidate = value.strip()
        if HEX_COLOR_RE.fullmatch(candidate):
            return candidate.lower()
    return fallback


def sanitize_font_family(value, fallback):
    if not isinstance(value, str):
        return fallback
    trimmed = value.strip()
    if not trimmed:
        return fallback
    safe = "".join(ch for ch in trimmed if ch.isalnum() or ch in " ,-'\"")
    safe = " ".join(safe.split())
    return safe[:96] if safe else fallback


def sanitize_font_size(value, fallback):
    try:
        parsed = int(value)
        return int(clamp(parsed, 18, 140))
    except Exception:
        return fallback


def sanitize_opacity(value, fallback):
    try:
        parsed = float(value)
        return round(clamp(parsed, 0.0, 1.0), 2)
    except Exception:
        return fallback


def init_subtitle_defaults():
    with subtitle_state_lock:
        subtitle_settings["font_family"] = sanitize_font_family(
            getattr(config, "SUBTITLE_DEFAULT_FONT_FAMILY", "Inter, Segoe UI, sans-serif"),
            "Inter, Segoe UI, sans-serif",
        )
        subtitle_settings["font_size_px"] = sanitize_font_size(
            getattr(config, "SUBTITLE_DEFAULT_FONT_SIZE", 56), 56
        )
        subtitle_settings["text_color"] = sanitize_hex_color(
            getattr(config, "SUBTITLE_DEFAULT_TEXT_COLOR", "#ffffff"), "#ffffff"
        )
        subtitle_settings["background_color"] = sanitize_hex_color(
            getattr(config, "SUBTITLE_DEFAULT_BG_COLOR", "#000000"), "#000000"
        )
        subtitle_settings["background_opacity"] = sanitize_opacity(
            getattr(config, "SUBTITLE_DEFAULT_BG_OPACITY", 0.45), 0.45
        )
        subtitle_settings["updated_at"] = now_iso()
        subtitle_state["updated_at"] = now_iso()


def get_subtitle_settings():
    with subtitle_state_lock:
        return {**subtitle_settings}


def get_subtitle_state():
    with subtitle_state_lock:
        return {**subtitle_state}


def emit_subtitle_settings(room=None):
    payload = get_subtitle_settings()
    socketio.emit("subtitle_settings", payload, room=room)


def emit_subtitle_update(room=None):
    payload = get_subtitle_state()
    socketio.emit("subtitle_update", payload, room=room)


def update_subtitle_settings(data):
    with subtitle_state_lock:
        subtitle_settings["font_family"] = sanitize_font_family(
            data.get("font_family", subtitle_settings["font_family"]),
            subtitle_settings["font_family"],
        )
        subtitle_settings["font_size_px"] = sanitize_font_size(
            data.get("font_size_px", subtitle_settings["font_size_px"]),
            subtitle_settings["font_size_px"],
        )
        subtitle_settings["text_color"] = sanitize_hex_color(
            data.get("text_color", subtitle_settings["text_color"]),
            subtitle_settings["text_color"],
        )
        subtitle_settings["background_color"] = sanitize_hex_color(
            data.get("background_color", subtitle_settings["background_color"]),
            subtitle_settings["background_color"],
        )
        subtitle_settings["background_opacity"] = sanitize_opacity(
            data.get("background_opacity", subtitle_settings["background_opacity"]),
            subtitle_settings["background_opacity"],
        )
        subtitle_settings["updated_at"] = now_iso()
        snapshot = {**subtitle_settings}
    socketio.emit("subtitle_settings", snapshot)
    return snapshot


def set_subtitle_text(text, final_value=True):
    if not isinstance(text, str):
        text = str(text)
    normalized = " ".join(text.split()).strip()
    if len(normalized) > 220:
        normalized = normalized[:220].rstrip()

    with subtitle_state_lock:
        subtitle_state["text"] = normalized
        subtitle_state["final"] = bool(final_value)
        subtitle_state["updated_at"] = now_iso()
        snapshot = {**subtitle_state}

    socketio.emit("subtitle_update", snapshot)
    return snapshot


def get_keyboard_capture_status():
    with keyboard_state_lock:
        return {
            **keyboard_capture_status,
            "pressed_count": len(pressed_keyboard_keys),
        }


def emit_keyboard_capture_status(room=None):
    socketio.emit("keyboard_status", get_keyboard_capture_status(), room=room)


def normalize_keyboard_key(key):
    try:
        char = getattr(key, "char", None)
    except Exception:
        char = None

    if isinstance(char, str) and char:
        if char == " ":
            return "Space"
        if len(char) == 1:
            return char.upper()
        return char

    name = getattr(key, "name", None)
    if not isinstance(name, str) or not name:
        raw = str(key)
        if raw.startswith("Key."):
            name = raw[4:]
        else:
            return raw

    key_map = {
        "space": "Space",
        "esc": "Escape",
        "escape": "Escape",
        "enter": "Enter",
        "return": "Enter",
        "tab": "Tab",
        "backspace": "Backspace",
        "caps_lock": "CapsLock",
        "shift": "Shift",
        "shift_l": "Shift",
        "shift_r": "Shift",
        "ctrl": "Ctrl",
        "ctrl_l": "Ctrl",
        "ctrl_r": "Ctrl",
        "alt": "Alt",
        "alt_l": "Alt",
        "alt_r": "Alt",
        "cmd": "Meta",
        "cmd_l": "Meta",
        "cmd_r": "Meta",
        "super_l": "Meta",
        "super_r": "Meta",
        "menu": "Menu",
        "left": "ArrowLeft",
        "right": "ArrowRight",
        "up": "ArrowUp",
        "down": "ArrowDown",
        "insert": "Insert",
        "delete": "Delete",
        "home": "Home",
        "end": "End",
        "page_up": "PageUp",
        "page_down": "PageDown",
    }
    if name in key_map:
        return key_map[name]
    if len(name) == 2 and name.startswith("f") and name[1].isdigit():
        return name.upper()
    if name.startswith("f") and name[1:].isdigit():
        return name.upper()
    return name.replace("_", " ").title()


def emit_keyboard_event(action, key_name):
    if action not in ("down", "up"):
        return
    socketio.emit("keyboard_event", {
        "action": action,
        "key": key_name,
        "at": now_iso(),
    })


def handle_keyboard_press(key):
    key_name = normalize_keyboard_key(key)
    if not key_name:
        return
    with keyboard_state_lock:
        if key_name in pressed_keyboard_keys:
            return
        pressed_keyboard_keys.add(key_name)
    emit_keyboard_event("down", key_name)


def handle_keyboard_release(key):
    key_name = normalize_keyboard_key(key)
    if not key_name:
        return
    with keyboard_state_lock:
        if key_name in pressed_keyboard_keys:
            pressed_keyboard_keys.remove(key_name)
    emit_keyboard_event("up", key_name)


def start_keyboard_capture():
    global keyboard_capture_listener

    enabled = bool(getattr(config, "KEYBOARD_CAPTURE_ENABLED", True))
    if not enabled:
        with keyboard_state_lock:
            keyboard_capture_status["enabled"] = False
            keyboard_capture_status["available"] = False
            keyboard_capture_status["active"] = False
            keyboard_capture_status["last_error"] = "Disabled by OVERLAYS_KEYBOARD_CAPTURE_ENABLED"
            keyboard_capture_status["updated_at"] = now_iso()
        log.info("Global keyboard capture disabled via config.")
        emit_keyboard_capture_status()
        return

    try:
        from pynput import keyboard as pynput_keyboard  # pylint: disable=import-outside-toplevel
    except Exception as e:
        with keyboard_state_lock:
            keyboard_capture_status["enabled"] = True
            keyboard_capture_status["available"] = False
            keyboard_capture_status["active"] = False
            keyboard_capture_status["last_error"] = f"pynput unavailable: {e}"
            keyboard_capture_status["updated_at"] = now_iso()
        log.warning("Global keyboard capture unavailable (%s). Install pynput to enable.", e)
        emit_keyboard_capture_status()
        return

    try:
        keyboard_capture_listener = pynput_keyboard.Listener(
            on_press=handle_keyboard_press,
            on_release=handle_keyboard_release,
        )
        keyboard_capture_listener.daemon = True
        keyboard_capture_listener.start()
        with keyboard_state_lock:
            keyboard_capture_status["enabled"] = True
            keyboard_capture_status["available"] = True
            keyboard_capture_status["active"] = True
            keyboard_capture_status["last_error"] = None
            keyboard_capture_status["updated_at"] = now_iso()
        log.info("Global keyboard capture started.")
    except Exception as e:
        with keyboard_state_lock:
            keyboard_capture_status["enabled"] = True
            keyboard_capture_status["available"] = False
            keyboard_capture_status["active"] = False
            keyboard_capture_status["last_error"] = str(e)
            keyboard_capture_status["updated_at"] = now_iso()
        log.warning("Global keyboard capture failed to start: %s", e)

    emit_keyboard_capture_status()


# ──────────────────────────────────────────────
# OBS WEBSOCKET CONNECTION
# ──────────────────────────────────────────────
obs_client = None
obs_mode = "disconnected"
obs_last_error = None


def connect_obs():
    """Connect to OBS via websocket. Non-blocking - retries in background."""
    global obs_client, obs_mode, obs_last_error
    try:
        from obswebsocket import obsws, requests as obs_requests

        obs_client = obsws(config.OBS_HOST, config.OBS_PORT, config.OBS_PASSWORD)
        obs_client.connect()
        log.info(f"Connected to OBS at {config.OBS_HOST}:{config.OBS_PORT}")
        obs_mode = "direct"
        obs_last_error = None
        return True
    except ImportError:
        log.warning("obs-websocket-py not installed. OBS control disabled.")
        obs_mode = "disabled"
        obs_last_error = "obs-websocket-py missing"
        return False
    except Exception as e:
        log.warning(f"Could not connect to OBS: {e} (will retry)")
        obs_client = None
        obs_mode = "fallback" if config.OBS_PROXY_VIA_FEBRUARY11 else "disconnected"
        obs_last_error = str(e)
        return False


def fallback_switch_scene(scene_name):
    """Fallback scene switch via FEBRUARY11 API."""
    global obs_mode, obs_last_error
    if not config.OBS_PROXY_VIA_FEBRUARY11:
        return False
    try:
        resp = http_requests.post(
            f"{config.FEBRUARY11_API_BASE_URL}/api/obs/program-scene",
            json={"sceneName": scene_name},
            timeout=2.5,
        )
        if resp.status_code >= 200 and resp.status_code < 300:
            obs_mode = "february11-fallback"
            obs_last_error = None
            return True
        obs_last_error = f"FEBRUARY11 scene switch failed ({resp.status_code})"
        return False
    except Exception as e:
        obs_last_error = f"FEBRUARY11 scene switch unavailable: {e}"
        return False


def fallback_get_scenes():
    """Fallback scene listing via FEBRUARY11 API."""
    global obs_mode, obs_last_error
    if not config.OBS_PROXY_VIA_FEBRUARY11:
        return []
    try:
        resp = http_requests.get(
            f"{config.FEBRUARY11_API_BASE_URL}/api/obs/scenes",
            timeout=2.5,
        )
        if resp.status_code >= 200 and resp.status_code < 300:
            payload = resp.json()
            scenes = payload.get("scenes", [])
            if isinstance(scenes, list):
                obs_mode = "february11-fallback"
                obs_last_error = None
                return scenes
        obs_last_error = f"FEBRUARY11 scene list failed ({resp.status_code})"
        return []
    except Exception as e:
        obs_last_error = f"FEBRUARY11 scene list unavailable: {e}"
        return []


def obs_switch_scene(scene_name):
    """Switch OBS to a different scene."""
    if not obs_client:
        ok = fallback_switch_scene(scene_name)
        if not ok:
            log.warning("OBS not connected, can't switch scene")
        return ok
    try:
        from obswebsocket import requests as obs_requests

        obs_client.call(obs_requests.SetCurrentProgramScene(sceneName=scene_name))
        log.info(f"Switched OBS scene to: {scene_name}")
        global obs_mode, obs_last_error
        obs_mode = "direct"
        obs_last_error = None
        return True
    except Exception as e:
        log.error(f"OBS scene switch failed: {e}")
        return fallback_switch_scene(scene_name)


def obs_get_scenes():
    """Get list of available OBS scenes."""
    if not obs_client:
        return fallback_get_scenes()
    try:
        from obswebsocket import requests as obs_requests

        response = obs_client.call(obs_requests.GetSceneList())
        scenes = [s["sceneName"] for s in response.datain.get("scenes", [])]
        global obs_mode, obs_last_error
        obs_mode = "direct"
        obs_last_error = None
        return scenes
    except Exception as e:
        log.error(f"Failed to get OBS scenes: {e}")
        return fallback_get_scenes()


def obs_toggle_source(source_name, visible=True):
    """Show/hide an OBS source."""
    if not obs_client:
        return False
    try:
        from obswebsocket import requests as obs_requests

        # Get current scene
        current = obs_client.call(obs_requests.GetCurrentProgramScene())
        scene_name = current.datain["currentProgramSceneName"]
        # Get scene item ID
        items = obs_client.call(
            obs_requests.GetSceneItemId(sceneName=scene_name, sourceName=source_name)
        )
        item_id = items.datain["sceneItemId"]
        # Toggle visibility
        obs_client.call(
            obs_requests.SetSceneItemEnabled(
                sceneName=scene_name, sceneItemId=item_id, sceneItemEnabled=visible
            )
        )
        return True
    except Exception as e:
        log.error(f"OBS toggle source failed: {e}")
        return False


# ──────────────────────────────────────────────
# TWITCH BOT (Chat + Events)
# ──────────────────────────────────────────────
twitch_bot = None


def start_twitch_bot():
    """Start the Twitch chat bot in a background thread."""
    global twitch_bot

    # Check if credentials are configured
    if "YOUR_" in config.TWITCH_OAUTH_TOKEN or "YOUR_" in config.TWITCH_CHANNEL:
        log.warning("=" * 50)
        log.warning("Twitch credentials not configured!")
        log.warning("Edit config.py and fill in your Twitch settings.")
        log.warning("Server will run without Twitch integration.")
        log.warning("=" * 50)
        return

    try:
        import twitchio
        from twitchio.ext import commands as twitch_commands
    except ImportError:
        log.warning("twitchio not installed. Twitch chat disabled.")
        return

    class Bot(twitch_commands.Bot):
        def __init__(self):
            super().__init__(
                token=config.TWITCH_OAUTH_TOKEN,
                prefix=config.COMMAND_PREFIX,
                initial_channels=[config.TWITCH_CHANNEL],
            )

        async def event_ready(self):
            log.info(f"Twitch bot connected as {self.nick}")
            log.info(f"Joined channel: {config.TWITCH_CHANNEL}")

        async def event_message(self, message):
            if message.echo:
                return

            # Track stats
            stream_stats["total_messages"] += 1

            # Build chat message data
            msg_data = {
                "username": message.author.name if message.author else "unknown",
                "display_name": message.author.display_name if message.author else "Unknown",
                "message": message.content,
                "color": getattr(message.author, "color", "#ffffff") or "#9147ff",
                "badges": [],  # Could parse badges here
                "timestamp": datetime.now().strftime("%H:%M"),
                "is_sub": getattr(message.author, "is_subscriber", False),
                "is_mod": getattr(message.author, "is_mod", False),
            }

            # Send to chat overlay via SocketIO
            socketio.emit("chat_message", msg_data)
            log.debug(f"Chat: {msg_data['display_name']}: {message.content}")

            # Store for clip detection
            now = time.time()
            recent_messages.append(msg_data)
            clip_message_times.append(now)

            # Check for auto-clip trigger
            check_clip_trigger(message.content, now)

            # Process commands
            await self.handle_commands(message)

        # ── CHAT COMMANDS ──

        @twitch_commands.command(name="scene")
        async def cmd_scene(ctx, *, scene_name: str = ""):
            """!scene <name> - Switch OBS scene (mod only)."""
            if not ctx.author.is_mod and ctx.author.name != config.TWITCH_CHANNEL:
                return
            if not scene_name:
                scenes = obs_get_scenes()
                await ctx.send(f"Available scenes: {', '.join(scenes)}")
                return
            if obs_switch_scene(scene_name):
                await ctx.send(f"Switched to scene: {scene_name}")
            else:
                await ctx.send("Could not switch scene. Check OBS connection.")

        @twitch_commands.command(name="stats")
        async def cmd_stats(ctx):
            """!stats - Show current stream stats."""
            s = stream_stats
            await ctx.send(
                f"Followers: +{s['followers_this_stream']} | "
                f"Subs: +{s['subs_this_stream']} | "
                f"Messages: {s['total_messages']} | "
                f"Viewers: {s['viewers']}"
            )

        @twitch_commands.command(name="uptime")
        async def cmd_uptime(ctx):
            """!uptime - Show how long stream has been live."""
            if stream_stats["stream_start"]:
                delta = datetime.now() - stream_stats["stream_start"]
                hours, remainder = divmod(int(delta.total_seconds()), 3600)
                minutes, _ = divmod(remainder, 60)
                await ctx.send(f"Stream has been live for {hours}h {minutes}m")
            else:
                await ctx.send("Stream timer not started. Use dashboard to start.")

        @twitch_commands.command(name="shoutout", aliases=["so"])
        async def cmd_shoutout(ctx, username: str = ""):
            """!so <user> - Shoutout a user (mod only)."""
            if not ctx.author.is_mod and ctx.author.name != config.TWITCH_CHANNEL:
                return
            if username:
                username = username.lstrip("@")
                await ctx.send(
                    f"Go check out @{username}! "
                    f"https://twitch.tv/{username}"
                )

        @twitch_commands.command(name="sound", aliases=["sfx"])
        async def cmd_sound(ctx, sound_name: str = ""):
            """!sound <name> - Play a soundboard sound."""
            if not sound_name:
                with soundboard_lock:
                    available = [s["slug"] for s in soundboard_sounds.values()]
                if available:
                    await ctx.send(f"Available sounds: {', '.join(available[:15])}")
                else:
                    await ctx.send("No sounds loaded. Add .mp3 files to static/sounds/soundboard/")
                return
            slug = sound_name.lower().strip()
            triggered_by = f"Chat: {ctx.author.display_name}"
            result = play_sound(slug, triggered_by)
            if result:
                await ctx.send(f"🔊 {result['name']}")
            else:
                await ctx.send(f"Sound '{sound_name}' not found or on cooldown.")

        @twitch_commands.command(name="clip")
        async def cmd_clip(ctx):
            """!clip - Create a clip of the current moment."""
            result = create_twitch_clip()
            if result:
                edit_url = result.get("edit_url", "")
                await ctx.send(f"🎬 Clip created! {edit_url}")
                socketio.emit("auto_clip", {
                    "message_count": 0,
                    "trigger": f"!clip by {ctx.author.display_name}",
                    "clip_id": result["clip_id"],
                    "edit_url": edit_url,
                    "created": True,
                })
                log_event("clip", ctx.author.display_name, {"clip_id": result["clip_id"]})
            else:
                await ctx.send("❌ Clip failed — not live or missing permissions.")

        @twitch_commands.command(name="chaos")
        async def cmd_chaos(ctx, preset_name: str = ""):
            """!chaos <preset> - Trigger a chaos effect on stream."""
            if not preset_name:
                names = [f"{p['icon']}{slug}" for slug, p in CHAOS_PRESETS.items()]
                await ctx.send(f"Chaos presets: {', '.join(names)}")
                return
            slug = preset_name.lower().strip()
            triggered_by = f"Chat: {ctx.author.display_name}"
            result = trigger_chaos(slug, triggered_by)
            if result:
                await ctx.send(f"{result['icon']} {result['name']} activated!")
            else:
                await ctx.send(f"Chaos '{preset_name}' not found or on cooldown ({CHAOS_COOLDOWN_SEC}s).")

    def run_bot():
        try:
            bot = Bot()
            bot.run()
        except Exception as e:
            log.error(f"Twitch bot error: {e}")

    thread = threading.Thread(target=run_bot, daemon=True)
    thread.start()
    log.info("Twitch bot thread started")


# ──────────────────────────────────────────────
# AUTO-CLIP DETECTION
# ──────────────────────────────────────────────
def create_twitch_clip():
    """Call the Twitch Create Clip API.
    Requires a user OAuth token with clips:edit scope.
    The OAuth token in config.TWITCH_OAUTH_TOKEN is used (strip 'oauth:' prefix).
    """
    oauth = config.TWITCH_OAUTH_TOKEN
    if oauth.startswith("oauth:"):
        oauth = oauth[6:]

    if "YOUR_" in config.TWITCH_CLIENT_ID or "YOUR_" in oauth:
        log.warning("Auto-clip: Twitch credentials not configured, skipping clip creation")
        return None

    try:
        # Get broadcaster ID
        headers = {
            "Client-ID": config.TWITCH_CLIENT_ID,
            "Authorization": f"Bearer {oauth}",
        }
        user_resp = http_requests.get(
            "https://api.twitch.tv/helix/users",
            headers=headers,
            params={"login": config.TWITCH_CHANNEL},
        )
        if user_resp.status_code != 200:
            log.error(f"Auto-clip: Failed to get broadcaster ID ({user_resp.status_code})")
            return None

        broadcaster_id = user_resp.json()["data"][0]["id"]

        # Create clip
        clip_resp = http_requests.post(
            "https://api.twitch.tv/helix/clips",
            headers=headers,
            params={"broadcaster_id": broadcaster_id},
        )

        if clip_resp.status_code in (200, 202):
            clip_data = clip_resp.json().get("data", [{}])[0]
            clip_id = clip_data.get("id", "unknown")
            edit_url = clip_data.get("edit_url", "")
            log.info(f"Auto-clip created! ID: {clip_id}")
            return {"clip_id": clip_id, "edit_url": edit_url}
        else:
            error_msg = clip_resp.text[:200]
            log.error(f"Auto-clip: Create clip failed ({clip_resp.status_code}): {error_msg}")
            # Common errors:
            # 401 = token missing clips:edit scope
            # 404 = broadcaster not live
            return None

    except Exception as e:
        log.error(f"Auto-clip: Exception creating clip: {e}")
        return None


def check_clip_trigger(message_text, now):
    """Check if chat is going crazy enough to auto-clip."""
    global last_clip_time

    # Don't clip more than once per 30 seconds
    if now - last_clip_time < 30:
        return

    # Check if message contains trigger words
    has_trigger = any(word in message_text for word in config.CLIP_TRIGGER_WORDS)
    if not has_trigger:
        return

    # Count messages in the clip window
    cutoff = now - config.CLIP_WINDOW_SECONDS
    recent_count = sum(1 for t in clip_message_times if t > cutoff)

    if recent_count >= config.CLIP_SPAM_THRESHOLD:
        last_clip_time = now
        log.info(f"AUTO-CLIP triggered! ({recent_count} msgs in {config.CLIP_WINDOW_SECONDS}s)")

        # Actually create the clip via Twitch API
        clip_result = create_twitch_clip()

        clip_payload = {
            "message_count": recent_count,
            "trigger": message_text[:50],
        }
        if clip_result:
            clip_payload["clip_id"] = clip_result["clip_id"]
            clip_payload["edit_url"] = clip_result["edit_url"]
            clip_payload["created"] = True
        else:
            clip_payload["created"] = False

        socketio.emit("auto_clip", clip_payload)
        log_event("auto_clip", data={
            "count": recent_count,
            "clip_id": clip_result["clip_id"] if clip_result else None,
        })


# ──────────────────────────────────────────────
# TWITCH EVENTSUB (Follows, Subs, Raids)
# ──────────────────────────────────────────────
def start_eventsub_polling():
    """
    Poll Twitch API for new followers/events.
    (Full EventSub requires a public webhook URL or websocket connection.
     For local dev, we poll the API periodically.)
    """
    if "YOUR_" in config.TWITCH_CLIENT_ID:
        return

    def poll_loop():
        import requests as http_requests

        last_follow_check = datetime.utcnow().isoformat() + "Z"
        token = None
        token_expires = 0

        while True:
            try:
                # Get/refresh app access token
                now = time.time()
                if not token or now >= token_expires:
                    resp = http_requests.post(
                        "https://id.twitch.tv/oauth2/token",
                        params={
                            "client_id": config.TWITCH_CLIENT_ID,
                            "client_secret": config.TWITCH_CLIENT_SECRET,
                            "grant_type": "client_credentials",
                        },
                    )
                    if resp.status_code == 200:
                        data = resp.json()
                        token = data["access_token"]
                        token_expires = now + data.get("expires_in", 3600) - 60
                        log.info("Got Twitch app access token")
                    else:
                        log.error(f"Token request failed: {resp.status_code}")
                        time.sleep(30)
                        continue

                headers = {
                    "Client-ID": config.TWITCH_CLIENT_ID,
                    "Authorization": f"Bearer {token}",
                }

                # Get broadcaster ID
                user_resp = http_requests.get(
                    "https://api.twitch.tv/helix/users",
                    headers=headers,
                    params={"login": config.TWITCH_CHANNEL},
                )
                if user_resp.status_code != 200:
                    time.sleep(30)
                    continue

                broadcaster_id = user_resp.json()["data"][0]["id"]

                # Check stream status (viewer count)
                stream_resp = http_requests.get(
                    "https://api.twitch.tv/helix/streams",
                    headers=headers,
                    params={"user_id": broadcaster_id},
                )
                if stream_resp.status_code == 200:
                    streams = stream_resp.json().get("data", [])
                    if streams:
                        viewers = streams[0].get("viewer_count", 0)
                        stream_stats["viewers"] = viewers
                        socketio.emit("viewer_update", {"viewers": viewers})

                # Check new followers
                follow_resp = http_requests.get(
                    "https://api.twitch.tv/helix/channels/followers",
                    headers=headers,
                    params={
                        "broadcaster_id": broadcaster_id,
                        "first": 5,
                    },
                )
                if follow_resp.status_code == 200:
                    followers = follow_resp.json().get("data", [])
                    for f in followers:
                        followed_at = f.get("followed_at", "")
                        if followed_at > last_follow_check:
                            username = f.get("user_name", "Someone")
                            log.info(f"New follower: {username}")
                            stream_stats["followers_this_stream"] += 1

                            # Fire alert to overlay
                            socketio.emit("alert", {
                                "type": "follow",
                                "username": username,
                                "message": f"{username} just followed!",
                                "sound": config.FOLLOW_SOUND,
                                "duration": config.ALERT_DURATION,
                            })

                            # Update stats overlay
                            socketio.emit("stats_update", stream_stats)
                            log_event("follow", username)

                            # Auto-increment follower goal
                            increment_goal("followers", 1)

                    if followers:
                        last_follow_check = datetime.utcnow().isoformat() + "Z"

            except Exception as e:
                log.error(f"EventSub polling error: {e}")

            time.sleep(15)  # Poll every 15 seconds

    thread = threading.Thread(target=poll_loop, daemon=True)
    thread.start()
    log.info("Twitch event polling started")


# ──────────────────────────────────────────────
# FLASK ROUTES - Overlays
# ──────────────────────────────────────────────
@app.route("/")
def index():
    """Redirect to dashboard."""
    return render_template("dashboard.html", config=config, stats=stream_stats)


@app.route("/dashboard")
def dashboard():
    """Control panel - open in your browser (not OBS)."""
    return render_template("dashboard.html", config=config, stats=stream_stats)


@app.route("/overlay/scene")
def scene():
    """Full 1920x1080 unified overlay - ONE browser source for everything."""
    return render_template("scene.html", config=config)


@app.route("/overlay/alerts")
def overlay_alerts():
    """Alert overlay - add as OBS browser source."""
    return render_template("alerts.html", config=config)


@app.route("/overlay/chat")
def overlay_chat():
    """Chat overlay - add as OBS browser source."""
    return render_template("chat.html", config=config)


@app.route("/overlay/stats")
def overlay_stats():
    """Stats bar overlay - add as OBS browser source."""
    return render_template("stats.html", config=config)


@app.route("/overlay/keyboard")
def overlay_keyboard():
    """Keyboard visualizer overlay."""
    return render_template("keyboard.html", config=config)


@app.route("/overlay/subtitles")
def overlay_subtitles():
    """Live subtitle overlay."""
    return render_template("subtitles.html", config=config)


@app.route("/overlay/avatar")
def overlay_avatar():
    """VRM avatar overlay - add as OBS browser source."""
    return render_template("avatar.html", config=config)


@app.route("/overlay/tracker")
def overlay_tracker():
    """Webcam tracker page — open in your regular browser.
    Captures webcam → MediaPipe → Kalidokit → sends rig data via Socket.IO
    to all connected avatar overlays (including OBS browser sources)."""
    return render_template("tracker.html", config=config)


@app.route("/overlay/soundboard")
def overlay_soundboard():
    """Sound board overlay — plays sounds with visual notifications."""
    return render_template("soundboard.html", config=config)


@app.route("/overlay/goals")
def overlay_goals():
    """Goal tracker overlay — animated progress bars for sub/follower/donation goals."""
    return render_template("goals.html", config=config)


@app.route("/overlay/chaos")
def overlay_chaos():
    """Chaos effects overlay — triggered by chat commands or dashboard."""
    return render_template("chaos.html", config=config)


# ──────────────────────────────────────────────
# API ROUTES (for dashboard controls)
# ──────────────────────────────────────────────
@app.route("/api/stats")
def api_stats():
    """Get current stream stats."""
    return jsonify(stream_stats)


@app.route("/api/test-alert", methods=["POST"])
def api_test_alert():
    """Fire a test alert (use from dashboard)."""
    data = request.json or {}
    alert_type = data.get("type", "follow")
    username = data.get("username", "TestUser")
    amount = data.get("amount", None)

    sounds = {
        "follow": config.FOLLOW_SOUND,
        "sub": config.SUB_SOUND,
        "raid": config.RAID_SOUND,
        "bits": getattr(config, "BITS_SOUND", ""),
        "donation": getattr(config, "DONATION_SOUND", ""),
    }
    messages = {
        "follow": f"{username} just followed!",
        "sub": f"{username} just subscribed!",
        "raid": f"{username} is raiding with {data.get('viewers', 50)} viewers!",
        "bits": f"{username} cheered {amount or 100} bits!",
        "donation": f"{username} donated {amount or '$5.00'}!",
    }

    alert_payload = {
        "type": alert_type,
        "username": username,
        "message": messages.get(alert_type, f"{alert_type} from {username}"),
        "sound": sounds.get(alert_type, ""),
        "duration": config.ALERT_DURATION,
    }
    if amount is not None:
        alert_payload["amount"] = amount

    socketio.emit("alert", alert_payload)

    log.info(f"Test alert fired: {alert_type} from {username}")
    return jsonify({"status": "ok"})


@app.route("/api/test-chat", methods=["POST"])
def api_test_chat():
    """Send a test chat message (use from dashboard)."""
    data = request.json or {}
    msg_data = {
        "username": data.get("username", "testuser"),
        "display_name": data.get("username", "TestUser"),
        "message": data.get("message", "This is a test message!"),
        "color": data.get("color", "#9147ff"),
        "badges": [],
        "timestamp": datetime.now().strftime("%H:%M"),
        "is_sub": False,
        "is_mod": False,
    }
    socketio.emit("chat_message", msg_data)
    return jsonify({"status": "ok"})


@app.route("/api/scene", methods=["POST"])
def api_switch_scene():
    """Switch OBS scene via API."""
    data = request.json or {}
    scene_name = data.get("scene", "")
    if scene_name and obs_switch_scene(scene_name):
        return jsonify({"status": "ok", "scene": scene_name})
    return jsonify({"status": "error", "message": "Could not switch scene"}), 400


@app.route("/api/scenes")
def api_get_scenes():
    """Get list of OBS scenes."""
    return jsonify({"scenes": obs_get_scenes(), "obs_mode": obs_mode, "obs_last_error": obs_last_error})


@app.route("/api/obs-status")
def api_obs_status():
    return jsonify({
        "connected_direct": obs_client is not None,
        "obs_mode": obs_mode,
        "obs_last_error": obs_last_error,
        "fallback_enabled": bool(config.OBS_PROXY_VIA_FEBRUARY11),
        "fallback_base_url": config.FEBRUARY11_API_BASE_URL,
    })


@app.route("/api/start-stream", methods=["POST"])
def api_start_stream():
    """Mark stream as started (for stats tracking)."""
    stream_stats["stream_start"] = datetime.now()
    stream_stats["followers_this_stream"] = 0
    stream_stats["subs_this_stream"] = 0
    stream_stats["raids_this_stream"] = 0
    stream_stats["total_messages"] = 0
    log.info("Stream session started")
    socketio.emit("stats_update", {
        **stream_stats,
        "stream_start": stream_stats["stream_start"].isoformat(),
    })
    return jsonify({"status": "ok"})


@app.route("/api/keyboard/status")
def api_keyboard_status():
    """Keyboard capture status for dashboard/overlay diagnostics."""
    return jsonify(get_keyboard_capture_status())


@app.route("/api/keyboard/test", methods=["POST"])
def api_keyboard_test():
    """Inject keyboard events manually for testing."""
    data = request.json or {}
    key_name = str(data.get("key", "")).strip() or "A"
    action = str(data.get("action", "down")).strip().lower()
    if action not in ("down", "up"):
        action = "down"
    emit_keyboard_event(action, key_name)
    return jsonify({"status": "ok", "action": action, "key": key_name})


@app.route("/api/subtitles/state")
def api_subtitle_state():
    """Current subtitle text payload."""
    return jsonify(get_subtitle_state())


@app.route("/api/subtitles/settings", methods=["GET", "POST"])
def api_subtitle_settings():
    """Get/update live subtitle styling."""
    if request.method == "GET":
        return jsonify(get_subtitle_settings())

    data = request.json or {}
    if not isinstance(data, dict):
        return jsonify({"status": "error", "message": "Invalid payload"}), 400
    settings = update_subtitle_settings(data)
    return jsonify({"status": "ok", "settings": settings})


@app.route("/api/subtitles/push", methods=["POST"])
def api_subtitle_push():
    """Push a subtitle line (used by dashboard STT)."""
    data = request.json or {}
    if not isinstance(data, dict):
        return jsonify({"status": "error", "message": "Invalid payload"}), 400
    raw_text = data.get("text", "")
    if not isinstance(raw_text, str):
        raw_text = str(raw_text)
    text_value = raw_text.strip()
    final_value = bool(data.get("final", True))

    if not text_value:
        return jsonify({"status": "error", "message": "text is required"}), 400

    payload = set_subtitle_text(text_value, final_value=final_value)
    log_event("subtitle", data={"text": payload["text"], "final": payload["final"]})
    return jsonify({"status": "ok", "subtitle": payload})


@app.route("/api/subtitles/clear", methods=["POST"])
def api_subtitle_clear():
    """Clear subtitle text immediately."""
    payload = set_subtitle_text("", final_value=True)
    return jsonify({"status": "ok", "subtitle": payload})


# ──────────────────────────────────────────────
# AVATAR API ROUTES
# ──────────────────────────────────────────────
@app.route("/api/avatar/settings", methods=["GET", "POST"])
def api_avatar_settings():
    """Get or update VRM avatar settings."""
    if request.method == "GET":
        with avatar_settings_lock:
            return jsonify(avatar_settings)

    data = request.json or {}
    with avatar_settings_lock:
        if "vrmPath" in data and isinstance(data["vrmPath"], str):
            avatar_settings["vrmPath"] = data["vrmPath"]
        if "webcamEnabled" in data:
            avatar_settings["webcamEnabled"] = bool(data["webcamEnabled"])
        if "idleBreathingSpeed" in data:
            avatar_settings["idleBreathingSpeed"] = float(data["idleBreathingSpeed"])
        if "idleSwayAmount" in data:
            avatar_settings["idleSwayAmount"] = float(data["idleSwayAmount"])
        if "autoLookAround" in data:
            avatar_settings["autoLookAround"] = bool(data["autoLookAround"])
        if "blinkInterval" in data:
            avatar_settings["blinkInterval"] = int(data["blinkInterval"])
        if "lerpAmount" in data:
            avatar_settings["lerpAmount"] = float(data["lerpAmount"])
        if "lerpAmountFace" in data:
            avatar_settings["lerpAmountFace"] = float(data["lerpAmountFace"])
        if "cameraPosition" in data and isinstance(data["cameraPosition"], dict):
            avatar_settings["cameraPosition"] = data["cameraPosition"]
        if "cameraLookAt" in data and isinstance(data["cameraLookAt"], dict):
            avatar_settings["cameraLookAt"] = data["cameraLookAt"]
        avatar_settings["updated_at"] = now_iso()
        snapshot = dict(avatar_settings)

    socketio.emit("avatar_settings", snapshot)
    log.info("Avatar settings updated")
    return jsonify({"status": "ok", "settings": snapshot})


@app.route("/api/avatar/expression", methods=["POST"])
def api_avatar_expression():
    """Trigger an expression on the VRM avatar."""
    data = request.json or {}
    expression = data.get("expression", "happy")
    intensity = float(data.get("intensity", 1.0))
    duration = int(data.get("duration", 2000))

    payload = {"expression": expression, "intensity": intensity, "duration": duration}
    socketio.emit("avatar_expression", payload)
    log.info(f"Avatar expression: {expression} (intensity={intensity}, duration={duration}ms)")
    return jsonify({"status": "ok", "expression": payload})


@app.route("/api/avatar/motion", methods=["POST"])
def api_avatar_motion():
    """Trigger a motion on the VRM avatar (nod, wave, headShake)."""
    data = request.json or {}
    motion_type = data.get("type", "nod")

    payload = {"type": motion_type}
    socketio.emit("avatar_motion", payload)
    log.info(f"Avatar motion: {motion_type}")
    return jsonify({"status": "ok", "motion": payload})


@app.route("/api/avatar/vrms", methods=["GET"])
def api_avatar_vrms():
    """List available VRM files."""
    vrm_dir = os.path.join(os.path.dirname(__file__), "static", "VRMs")
    vrms = []
    if os.path.isdir(vrm_dir):
        for f in os.listdir(vrm_dir):
            if f.lower().endswith(".vrm"):
                vrms.append({
                    "name": f,
                    "path": f"/static/VRMs/{f}",
                    "size_mb": round(os.path.getsize(os.path.join(vrm_dir, f)) / (1024 * 1024), 1),
                })
    return jsonify({"vrms": vrms})


# ──────────────────────────────────────────────
# SOUND BOARD API ROUTES
# ──────────────────────────────────────────────
@app.route("/api/soundboard/sounds", methods=["GET"])
def api_soundboard_sounds():
    """List all available soundboard sounds."""
    with soundboard_lock:
        sounds = list(soundboard_sounds.values())
    return jsonify({"sounds": sounds})


@app.route("/api/soundboard/play", methods=["POST"])
def api_soundboard_play():
    """Play a soundboard sound."""
    data = request.json or {}
    slug = str(data.get("slug", "")).strip()
    triggered_by = str(data.get("triggeredBy", "Dashboard")).strip()
    if not slug:
        return jsonify({"status": "error", "message": "slug is required"}), 400
    result = play_sound(slug, triggered_by)
    if result is None:
        return jsonify({"status": "error", "message": "Sound not found or on cooldown"}), 404
    return jsonify({"status": "ok", "sound": result})


@app.route("/api/soundboard/reload", methods=["POST"])
def api_soundboard_reload():
    """Reload soundboard sounds from disk."""
    with soundboard_lock:
        soundboard_sounds.clear()
    init_soundboard()
    with soundboard_lock:
        count = len(soundboard_sounds)
    return jsonify({"status": "ok", "count": count})


# ──────────────────────────────────────────────
# CLIP API
# ──────────────────────────────────────────────
@app.route("/api/clip", methods=["POST"])
def api_create_clip():
    """Manually create a Twitch clip right now."""
    result = create_twitch_clip()
    if result:
        socketio.emit("auto_clip", {
            "message_count": 0,
            "trigger": "Manual clip from dashboard",
            "clip_id": result["clip_id"],
            "edit_url": result["edit_url"],
            "created": True,
        })
        log_event("clip", "Dashboard", {"clip_id": result["clip_id"]})
        return jsonify({"status": "ok", "clip": result})
    return jsonify({"status": "error", "message": "Clip creation failed — check logs. Ensure OAuth token has clips:edit scope and you are live."}), 500


# ──────────────────────────────────────────────
# GOAL TRACKER API
# ──────────────────────────────────────────────
@app.route("/api/goals", methods=["GET"])
def api_goals():
    """Get all stream goals."""
    return jsonify({"goals": get_goals()})


@app.route("/api/goals/update", methods=["POST"])
def api_goals_update():
    """Update a specific goal. Body: { id, current?, target?, title?, enabled? }"""
    data = request.json or {}
    goal_id = str(data.get("id", "")).strip()
    if not goal_id:
        return jsonify({"status": "error", "message": "id is required"}), 400
    result = update_goal(goal_id, data)
    if result is None:
        return jsonify({"status": "error", "message": f"Goal '{goal_id}' not found"}), 404
    return jsonify({"status": "ok", "goal": result})


@app.route("/api/goals/increment", methods=["POST"])
def api_goals_increment():
    """Increment a goal by amount. Body: { id, amount? }"""
    data = request.json or {}
    goal_id = str(data.get("id", "")).strip()
    amount = int(data.get("amount", 1))
    if not goal_id:
        return jsonify({"status": "error", "message": "id is required"}), 400
    increment_goal(goal_id, amount)
    return jsonify({"status": "ok", "goals": get_goals()})


@app.route("/api/goals/reset", methods=["POST"])
def api_goals_reset():
    """Reset all goal progress to 0."""
    with goals_lock:
        for g in stream_goals:
            g["current"] = 0
    snapshot = get_goals()
    socketio.emit("goals_update", {"goals": snapshot})
    return jsonify({"status": "ok", "goals": snapshot})


# ──────────────────────────────────────────────
# CHAOS API
# ──────────────────────────────────────────────
# ──────────────────────────────────────────────
# POST-STREAM REPORT API
# ──────────────────────────────────────────────
@app.route("/api/report", methods=["GET"])
def api_stream_report():
    """Generate a post-stream report from SQLite data.
    Query param ?since=ISO_DATETIME to specify start (defaults to current session or last 6h).
    """
    since_param = request.args.get("since", "")
    if since_param:
        since_dt = since_param
    elif stream_stats.get("stream_start"):
        since_dt = stream_stats["stream_start"].strftime("%Y-%m-%d %H:%M:%S")
    else:
        # Default to last 6 hours
        since_dt = (datetime.now() - timedelta(hours=6)).strftime("%Y-%m-%d %H:%M:%S")

    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()

        # Total events by type
        c.execute(
            "SELECT event_type, COUNT(*) as cnt FROM events WHERE created_at >= ? GROUP BY event_type ORDER BY cnt DESC",
            (since_dt,),
        )
        event_counts = {row["event_type"]: row["cnt"] for row in c.fetchall()}

        # Top chatters (by chat_message events)
        c.execute(
            "SELECT username, COUNT(*) as cnt FROM events WHERE event_type='chat_message' AND created_at >= ? AND username != '' GROUP BY username ORDER BY cnt DESC LIMIT 10",
            (since_dt,),
        )
        top_chatters = [{"username": row["username"], "messages": row["cnt"]} for row in c.fetchall()]

        # New followers
        c.execute(
            "SELECT username, created_at FROM events WHERE event_type='follow' AND created_at >= ? ORDER BY created_at",
            (since_dt,),
        )
        new_followers = [{"username": row["username"], "at": row["created_at"]} for row in c.fetchall()]

        # Sounds played
        c.execute(
            "SELECT data, COUNT(*) as cnt FROM events WHERE event_type='soundboard' AND created_at >= ? GROUP BY data ORDER BY cnt DESC LIMIT 10",
            (since_dt,),
        )
        sounds_played = []
        for row in c.fetchall():
            try:
                d = json.loads(row["data"]) if isinstance(row["data"], str) else row["data"]
                name = d.get("sound", "unknown") if isinstance(d, dict) else str(d)
            except Exception:
                name = str(row["data"])
            sounds_played.append({"sound": name, "count": row["cnt"]})

        # Chaos presets triggered
        c.execute(
            "SELECT data, COUNT(*) as cnt FROM events WHERE event_type='chaos' AND created_at >= ? GROUP BY data ORDER BY cnt DESC",
            (since_dt,),
        )
        chaos_triggered = []
        for row in c.fetchall():
            try:
                d = json.loads(row["data"]) if isinstance(row["data"], str) else row["data"]
                name = d.get("preset", "unknown") if isinstance(d, dict) else str(d)
            except Exception:
                name = str(row["data"])
            chaos_triggered.append({"preset": name, "count": row["cnt"]})

        # Timeline — event activity per 5 min bucket
        c.execute(
            "SELECT strftime('%H:%M', created_at, '-' || (strftime('%M', created_at) % 5) || ' minutes') as bucket, COUNT(*) as cnt "
            "FROM events WHERE created_at >= ? GROUP BY bucket ORDER BY bucket",
            (since_dt,),
        )
        timeline = [{"time": row["bucket"], "events": row["cnt"]} for row in c.fetchall()]

        # Total events
        c.execute("SELECT COUNT(*) as total FROM events WHERE created_at >= ?", (since_dt,))
        total_events = c.fetchone()["total"]

        conn.close()

        # Duration
        duration_str = ""
        if stream_stats.get("stream_start"):
            delta = datetime.now() - stream_stats["stream_start"]
            hours, remainder = divmod(int(delta.total_seconds()), 3600)
            minutes, seconds = divmod(remainder, 60)
            duration_str = f"{hours}h {minutes}m {seconds}s"

        report = {
            "since": since_dt,
            "duration": duration_str,
            "total_events": total_events,
            "event_counts": event_counts,
            "stats": {
                "followers": stream_stats.get("followers_this_stream", 0),
                "subs": stream_stats.get("subs_this_stream", 0),
                "raids": stream_stats.get("raids_this_stream", 0),
                "peak_viewers": stream_stats.get("peak_viewers", 0),
                "total_messages": stream_stats.get("total_messages", 0),
            },
            "top_chatters": top_chatters,
            "new_followers": new_followers,
            "sounds_played": sounds_played,
            "chaos_triggered": chaos_triggered,
            "timeline": timeline,
            "goals": get_goals(),
        }

        return jsonify(report)

    except Exception as e:
        log.error(f"Report generation error: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/report/html", methods=["GET"])
def api_stream_report_html():
    """Render a pretty HTML post-stream report page."""
    return render_template("report.html", config=config)


# ──────────────────────────────────────────────
# CONFIG UI API
# ──────────────────────────────────────────────
CONFIG_FIELDS = [
    {"key": "TWITCH_CLIENT_ID", "label": "Twitch Client ID", "type": "text", "group": "Twitch", "secret": True},
    {"key": "TWITCH_CLIENT_SECRET", "label": "Twitch Client Secret", "type": "text", "group": "Twitch", "secret": True},
    {"key": "TWITCH_OAUTH_TOKEN", "label": "Twitch OAuth Token", "type": "text", "group": "Twitch", "secret": True},
    {"key": "TWITCH_CHANNEL", "label": "Twitch Channel", "type": "text", "group": "Twitch"},
    {"key": "TWITCH_BOT_NAME", "label": "Bot Username", "type": "text", "group": "Twitch"},
    {"key": "OBS_HOST", "label": "OBS Host", "type": "text", "group": "OBS"},
    {"key": "OBS_PORT", "label": "OBS Port", "type": "number", "group": "OBS"},
    {"key": "OBS_PASSWORD", "label": "OBS Password", "type": "text", "group": "OBS", "secret": True},
    {"key": "OVERLAYS_SERVER_HOST", "label": "Server Host", "type": "text", "group": "Server"},
    {"key": "OVERLAYS_SERVER_PORT", "label": "Server Port", "type": "number", "group": "Server"},
    {"key": "OVERLAYS_SECRET_KEY", "label": "Secret Key", "type": "text", "group": "Server", "secret": True},
    {"key": "OVERLAYS_KEYBOARD_CAPTURE_ENABLED", "label": "Keyboard Capture", "type": "bool", "group": "Server"},
    {"key": "OBS_PROXY_VIA_FEBRUARY11", "label": "OBS Proxy via FEBRUARY11", "type": "bool", "group": "Server"},
    {"key": "FEBRUARY11_API_BASE_URL", "label": "FEBRUARY11 API URL", "type": "text", "group": "Server"},
    {"key": "SUBTITLE_DEFAULT_FONT_SIZE", "label": "Subtitle Font Size", "type": "number", "group": "Subtitles"},
    {"key": "SUBTITLE_DEFAULT_TEXT_COLOR", "label": "Subtitle Text Color", "type": "color", "group": "Subtitles"},
    {"key": "SUBTITLE_DEFAULT_BG_COLOR", "label": "Subtitle BG Color", "type": "color", "group": "Subtitles"},
    {"key": "SUBTITLE_DEFAULT_BG_OPACITY", "label": "Subtitle BG Opacity", "type": "number", "group": "Subtitles"},
]

# Map config.py attribute names to env var names
CONFIG_ATTR_TO_ENV = {
    "SERVER_HOST": "OVERLAYS_SERVER_HOST",
    "SERVER_PORT": "OVERLAYS_SERVER_PORT",
    "SECRET_KEY": "OVERLAYS_SECRET_KEY",
    "KEYBOARD_CAPTURE_ENABLED": "OVERLAYS_KEYBOARD_CAPTURE_ENABLED",
}

ENV_FILE_PATH = os.path.join(os.path.dirname(__file__), ".env")


def read_env_file():
    """Read .env file into a dict."""
    env = {}
    if os.path.isfile(ENV_FILE_PATH):
        with open(ENV_FILE_PATH, "r") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def write_env_file(env_dict):
    """Write a dict back to .env file."""
    lines = []
    if os.path.isfile(ENV_FILE_PATH):
        with open(ENV_FILE_PATH, "r") as f:
            for line in f:
                stripped = line.strip()
                if stripped and not stripped.startswith("#") and "=" in stripped:
                    key = stripped.split("=", 1)[0].strip()
                    if key in env_dict:
                        lines.append(f'{key}={env_dict.pop(key)}\n')
                        continue
                lines.append(line)
    # Append any new keys not in file
    for k, v in env_dict.items():
        lines.append(f'{k}={v}\n')
    with open(ENV_FILE_PATH, "w") as f:
        f.writelines(lines)


def get_config_value(env_key):
    """Get current runtime value for a config env key."""
    # Map env key to config.py attribute
    reverse_map = {v: k for k, v in CONFIG_ATTR_TO_ENV.items()}
    attr_name = reverse_map.get(env_key, env_key)
    val = getattr(config, attr_name, None)
    if val is None:
        val = os.getenv(env_key, "")
    return val


@app.route("/api/config", methods=["GET"])
def api_config_get():
    """Get current config values (secrets are masked)."""
    env = read_env_file()
    fields = []
    for field in CONFIG_FIELDS:
        val = env.get(field["key"], "")
        if not val:
            val = str(get_config_value(field["key"]))
        # Mask secrets
        display = val
        if field.get("secret") and val and len(val) > 4:
            display = val[:2] + "•" * (len(val) - 4) + val[-2:]
        fields.append({
            **field,
            "value": val,
            "display": display,
        })
    return jsonify({"fields": fields})


@app.route("/api/config", methods=["POST"])
def api_config_save():
    """Save config values to .env file. Requires server restart to take effect."""
    data = request.json or {}
    updates = data.get("values", {})
    if not updates:
        return jsonify({"status": "error", "message": "No values provided"}), 400

    env = read_env_file()
    for key, value in updates.items():
        # Only allow known keys
        known = {f["key"] for f in CONFIG_FIELDS}
        if key in known:
            env[key] = str(value)
    write_env_file(env)
    return jsonify({"status": "ok", "message": "Saved to .env — restart server to apply changes"})


@app.route("/config")
def config_page():
    """Config UI page."""
    return render_template("config_ui.html", config=config)


@app.route("/api/chaos/presets", methods=["GET"])
def api_chaos_presets():
    """List all chaos presets."""
    presets = [
        {**v, "slug": k} for k, v in CHAOS_PRESETS.items()
    ]
    return jsonify({"presets": presets})


@app.route("/api/chaos/trigger", methods=["POST"])
def api_chaos_trigger():
    """Trigger a chaos preset. Body: { slug }"""
    data = request.json or {}
    slug = str(data.get("slug", "")).strip()
    if not slug:
        return jsonify({"status": "error", "message": "slug is required"}), 400
    result = trigger_chaos(slug, "Dashboard")
    if result is None:
        return jsonify({"status": "error", "message": "Preset not found or on cooldown"}), 404
    return jsonify({"status": "ok", "chaos": result})


# ──────────────────────────────────────────────
# SOCKETIO EVENTS
# ──────────────────────────────────────────────
@socketio.on("connect")
def handle_connect():
    log.info(f"Client connected: {request.sid}")
    emit_keyboard_capture_status(room=request.sid)
    emit_subtitle_settings(room=request.sid)
    emit_subtitle_update(room=request.sid)
    with avatar_settings_lock:
        socketio.emit("avatar_settings", dict(avatar_settings), room=request.sid)
    socketio.emit("goals_update", {"goals": get_goals()}, room=request.sid)


@socketio.on("disconnect")
def handle_disconnect():
    log.info(f"Client disconnected: {request.sid}")


@socketio.on("request_stats")
def handle_stats_request():
    """Client requesting current stats."""
    data = {**stream_stats}
    if data["stream_start"]:
        data["stream_start"] = data["stream_start"].isoformat()
    socketio.emit("stats_update", data, room=request.sid)


@socketio.on("avatar_tracking_toggle")
def handle_avatar_tracking_toggle(data):
    """Toggle webcam tracking on the avatar overlay."""
    enabled = bool(data.get("enabled", True)) if isinstance(data, dict) else True
    with avatar_settings_lock:
        avatar_settings["webcamEnabled"] = enabled
        avatar_settings["updated_at"] = now_iso()
    socketio.emit("avatar_tracking", {"enabled": enabled})
    log.info(f"Avatar webcam tracking {'enabled' if enabled else 'disabled'}")


@socketio.on("avatar_rig_data")
def handle_avatar_rig_data(data):
    """Relay webcam tracking rig data from the tracker page to all avatar overlays.
    The tracker.html page captures webcam → MediaPipe → Kalidokit → emits rig data here.
    This event broadcasts it so OBS browser sources (which can't access webcam) receive it."""
    socketio.emit("avatar_rig_data", data, include_self=False)


# ──────────────────────────────────────────────
# MAIN
# ──────────────────────────────────────────────
def main():
    log.info("=" * 50)
    log.info("  STREAM AUTOMATION SERVER")
    log.info("=" * 50)

    # Init database
    init_db()
    init_subtitle_defaults()
    init_soundboard()

    # Connect to OBS
    connect_obs()

    # Start Twitch bot
    start_twitch_bot()

    # Start event polling
    start_eventsub_polling()
    start_keyboard_capture()

    log.info("")
    log.info("  Overlay URLs (add as OBS Browser Sources):")
    log.info(f"    Alerts:    http://localhost:{config.SERVER_PORT}/overlay/alerts")
    log.info(f"    Chat:      http://localhost:{config.SERVER_PORT}/overlay/chat")
    log.info(f"    Stats:     http://localhost:{config.SERVER_PORT}/overlay/stats")
    log.info(f"    Keyboard:  http://localhost:{config.SERVER_PORT}/overlay/keyboard")
    log.info(f"    Subtitles: http://localhost:{config.SERVER_PORT}/overlay/subtitles")
    log.info(f"    Avatar:    http://localhost:{config.SERVER_PORT}/overlay/avatar")
    log.info(f"    Soundboard:http://localhost:{config.SERVER_PORT}/overlay/soundboard")
    log.info(f"    Goals:     http://localhost:{config.SERVER_PORT}/overlay/goals")
    log.info(f"    Chaos:     http://localhost:{config.SERVER_PORT}/overlay/chaos")
    log.info(f"    Tracker:   http://localhost:{config.SERVER_PORT}/overlay/tracker  (open in browser, feeds webcam to avatar)")
    log.info(f"    Dashboard: http://localhost:{config.SERVER_PORT}/dashboard")
    log.info("")

    # Run Flask + SocketIO
    socketio.run(
        app,
        host=config.SERVER_HOST,
        port=config.SERVER_PORT,
        debug=False,
        use_reloader=False,
        allow_unsafe_werkzeug=True,
    )


if __name__ == "__main__":
    main()
