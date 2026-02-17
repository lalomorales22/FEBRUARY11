# OBS-Overlays — Stream Overlay Sidecar

Self-hosted Twitch streaming overlay server built with Python Flask + SocketIO. Provides all the browser-source overlays, Twitch chat bot, alert system, VTuber avatar, and stream control dashboard for the **FEBRUARY11** system.

> This is the Python sidecar. It runs alongside the Node/TypeScript backend. See the [root README](../README.md) for the full system overview.

## What This Server Does

- **12 browser-source overlays** — transparent HTML pages designed for OBS
- **Twitch chat bot** via twitchio — 7 chat commands, message relay, event detection
- **EventSub polling** — follower/viewer tracking from Twitch Helix API
- **Auto-clip** — triggers on chat activity spikes, calls Twitch Helix Create Clip API
- **VRM avatar system** — 3D VTuber avatar with webcam tracking relay + outfit hot-swap
- **Sound board** — auto-scans sound files, playable from dashboard or `!sound` chat command
- **Goal tracker** — follower/sub/donation/bits progress bars with auto-increment on events
- **Chaos effects** — 8 fullscreen visual effects triggered by chat or dashboard
- **Keyboard capture** — global key listener for keyboard visualizer overlay
- **Live subtitles** — real-time subtitle rendering with STT support via Web Speech API
- **Post-stream report** — auto-generated HTML summary with timeline, top chatters, event breakdown
- **Web config editor** — `.env` editor at `/config` with secret masking and grouped fields
- **SQLite logging** — all stream events persisted locally
- **Control dashboard** — full panel: alerts, avatar controls, sounds, goals, chaos, clips, STT
- **REST API** — 30+ endpoints for full control over all features

## Overlays

Add these as **OBS Browser Sources**:

| Overlay | URL | Recommended Size | Description |
|---------|-----|-----------------|-------------|
| **Unified Scene** | `/overlay/scene` | 1920×1080 | All-in-one: alerts + chat + stats bar + ticker |
| **Alerts** | `/overlay/alerts` | 800×600 | Animated follow/sub/raid/bits/donation alerts with sound + particles |
| **Chat** | `/overlay/chat` | 400×600 | Twitch chat with colors, badges, fade animations |
| **Stats Bar** | `/overlay/stats` | 600×80 | Viewers, followers, subs, messages, uptime |
| **Keyboard** | `/overlay/keyboard` | 1280×420 | Translucent keyboard that lights up as you type |
| **Subtitles** | `/overlay/subtitles` | 1920×1080 | Live subtitle line with configurable styling |
| **VRM Avatar** | `/overlay/avatar` | 1920×1080 | 3D VTuber model — receives tracking data via Socket.IO |
| **Webcam Tracker** | `/overlay/tracker` | N/A (browser tab) | Open in your browser — captures webcam, sends to avatar |
| **Sound Board** | `/overlay/soundboard` | 800×200 | Sound effect notification popup with animated display |
| **Goal Tracker** | `/overlay/goals` | 1920×1080 | Animated progress bars for follower/sub/donation/bits goals |
| **Chaos Effects** | `/overlay/chaos` | 1920×1080 | 8 fullscreen visual effects (disco, earthquake, confetti, matrix, rave, glitch, hearts, jumpscare) |

**Dashboard** at `/dashboard` — full control panel: test alerts, avatar controls (VRM switch, expressions, motions), sound board, goal tracker, chaos triggers, subtitle STT, clip creation, and overlay URL list.

**Post-Stream Report** at `/api/report/html` — auto-generated summary with stat cards, event timeline, top chatters, event breakdown, and goal progress.

**Config Editor** at `/config` — web-based `.env` editor with grouped fields, secret masking, toggle switches, and color pickers.

## VRM Avatar + Webcam Tracker

The avatar system uses a **relay architecture** so OBS doesn't need webcam access:

```
Your webcam
    ↓
Tracker page (regular browser tab)
    ↓  MediaPipe Holistic → Kalidokit → bone rotations
Socket.IO emit("avatar_rig_data")
    ↓
Flask server (relay)
    ↓  Socket.IO broadcast
Avatar overlay (OBS browser source)
    ↓  Three.js + @pixiv/three-vrm
3D avatar mirrors your movements
```

**Tracking features:**
- Face: head rotation, eye blink, pupil direction, mouth visemes (A/E/I/O/U)
- Pose: hips, spine, arms (upper + lower)
- Hands: all 5 fingers × 3 segments + wrist
- Lerp smoothing on all bones to reduce jitter
- Automatic fallback to idle animations when tracker disconnects (breathing, sway, blink, look-around)
- Stream event reactions: follows → wave, subs → nod, raids → surprised

**VRM files** go in `static/VRMs/`. The current model path is configurable via `/api/avatar/settings`.

## Quick Start

```bash
# From the project root:
npm run overlays:setup    # creates venv, installs Python deps
npm run overlays:serve    # launches server on port 5555
```

Or manually:

```bash
cd OBS-Overlays
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python server.py
```

## Configuration

All settings in `config.py`. You can also edit settings via the **web-based config editor** at `/config` (reads/writes the `.env` file):

| Section | What It Controls |
|---------|-----------------|
| **Twitch** | Client ID, secret, OAuth token, channel name |
| **OBS** | Host, port, password for direct OBS WebSocket |
| **FEBRUARY11** | Node backend URL for fallback OBS control |
| **Server** | Host (`0.0.0.0`), port (`5555`), secret key |
| **Alerts** | Duration, sound files, animation timing |
| **Chat** | Max messages, command prefix, fade timing |
| **Auto-Clip** | Spam threshold, trigger words, time window |
| **Theme** | Primary/secondary colors, backgrounds, fonts |
| **Keyboard** | Global capture on/off |
| **Subtitles** | Default font, size, colors, background opacity |

## API Endpoints

### Stream Control
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/stats` | Current stream stats |
| POST | `/api/test-alert` | Fire a test alert |
| POST | `/api/test-chat` | Send a test chat message |
| POST | `/api/scene` | Switch OBS scene |
| GET | `/api/scenes` | List OBS scenes |
| GET | `/api/obs-status` | OBS connection status |
| POST | `/api/start-stream` | Mark stream as started |

### Keyboard
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/keyboard/status` | Keyboard capture status |
| POST | `/api/keyboard/test` | Inject test key events |

### Subtitles
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/subtitles/state` | Current subtitle text |
| GET/POST | `/api/subtitles/settings` | Get/update subtitle styling |
| POST | `/api/subtitles/push` | Push subtitle text |
| POST | `/api/subtitles/clear` | Clear subtitle text |

### Avatar
| Method | Path | Purpose |
|--------|------|---------|
| GET/POST | `/api/avatar/settings` | Get/update avatar config |
| POST | `/api/avatar/expression` | Trigger expression (happy, surprised, etc.) |
| POST | `/api/avatar/motion` | Trigger motion (nod, wave, headShake) |
| GET | `/api/avatar/vrms` | List available VRM files |

### Sound Board
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/soundboard/sounds` | List available sound effects |
| POST | `/api/soundboard/play` | Play a sound effect `{ name }` |

### Goals
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/goals` | Get all stream goals |
| POST | `/api/goals/update` | Update a goal `{ id, current?, target?, title?, enabled? }` |
| POST | `/api/goals/increment` | Increment a goal `{ id, amount? }` |
| POST | `/api/goals/reset` | Reset all goal progress to 0 |

### Chaos Effects
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/chaos/presets` | List all 8 chaos presets |
| POST | `/api/chaos/trigger` | Trigger a chaos effect `{ slug }` |

### Clip
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/clip` | Create a Twitch clip (calls Helix API) |

### Post-Stream Report
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/report` | JSON report data (stats, timeline, top chatters, etc.) |
| GET | `/api/report/html` | Pretty HTML report page |

### Config
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/config` | Get all config fields with values |
| POST | `/api/config` | Save config values to `.env` file |

### Socket.IO Events

| Event | Direction | Purpose |
|-------|-----------|---------|
| `chat_message` | Server → Client | New chat message |
| `alert` | Server → Client | Follow/sub/raid/bits/donation alert |
| `stats_update` | Server → Client | Updated stream stats |
| `keyboard_event` | Server → Client | Key press/release |
| `subtitle_update` | Server → Client | New subtitle text |
| `avatar_settings` | Server → Client | Avatar config update |
| `avatar_expression` | Server → Client | Trigger expression |
| `avatar_motion` | Server → Client | Trigger motion |
| `avatar_rig_data` | Client → Server → All | Webcam tracking data relay |
| `avatar_tracking_toggle` | Client → Server | Enable/disable tracking |
| `soundboard_play` | Server → Client | Sound effect triggered |
| `goals_update` | Server → Client | Goal progress changed |
| `chaos_trigger` | Server → Client | Chaos effect activated |
| `auto_clip` | Server → Client | Clip created notification |

## Chat Commands

| Command | Description | Who Can Use |
|---------|-------------|-------------|
| `!scene <name>` | Switch OBS scene | Mods + Broadcaster |
| `!stats` | Show stream stats in chat | Everyone |
| `!uptime` | Show stream uptime | Everyone |
| `!so <user>` | Shoutout a user | Mods + Broadcaster |
| `!sound [name]` | Play a sound effect (no arg = list available) | Everyone |
| `!chaos [preset]` | Trigger a chaos visual effect (no arg = list presets) | Everyone |
| `!clip` | Create a Twitch clip of the current moment | Everyone |

## Project Structure

```
OBS-Overlays/
├── server.py              # Main server (~1700 lines)
├── config.py              # All configuration
├── requirements.txt       # Python dependencies
├── setup.sh               # Venv setup script
├── stream_data.db         # SQLite database (auto-created)
├── templates/
│   ├── dashboard.html     # Full control panel (alerts, avatar, sounds, goals, chaos, clips, STT)
│   ├── scene.html         # Unified 1920x1080 overlay
│   ├── alerts.html        # Alert animations (follow/sub/raid/bits/donation)
│   ├── chat.html          # Chat display
│   ├── stats.html         # Stats bar
│   ├── keyboard.html      # Keyboard visualizer
│   ├── subtitles.html     # Live subtitles
│   ├── avatar.html        # VRM avatar renderer (Three.js)
│   ├── tracker.html       # Webcam tracker (MediaPipe + Kalidokit)
│   ├── soundboard.html    # Sound effect notification overlay
│   ├── goals.html         # Goal tracker progress bars
│   ├── chaos.html         # Chaos effects (8 fullscreen visual presets)
│   ├── report.html        # Post-stream report page
│   └── config_ui.html     # Web-based .env config editor
└── static/
    ├── VRMs/              # VRM avatar model files
    │   └── lalo.vrm
    └── sounds/
        ├── soundboard/    # Sound board effects (auto-scanned on startup)
        └── *.mp3          # Alert sound files (follow, sub, raid, bits, donation)
```

## Dependencies

```
flask==3.1.0
flask-socketio==5.5.1
obs-websocket-py==1.0
twitchio==2.10.0
requests==2.32.3
pynput==1.7.7
```

## Tech Stack

- **Flask 3.1** + **Flask-SocketIO** — HTTP server + real-time communication
- **twitchio** — Twitch IRC chat bot
- **obs-websocket-py** — direct OBS WebSocket control
- **pynput** — global keyboard event capture
- **Three.js** + **@pixiv/three-vrm** — 3D VRM rendering (CDN-loaded in browser)
- **MediaPipe Holistic** + **Kalidokit** — webcam tracking (CDN-loaded in browser)
- **SQLite** — event persistence

## Network Access

Server binds to `0.0.0.0` by default — accessible from any device on your local network. Use your machine's IP address instead of `localhost` (e.g., `http://192.168.x.x:5555/dashboard`).

**Note:** Webcam access on the tracker page requires a secure context. From other devices, you may need HTTPS or a browser flag exception for `getUserMedia` to work over plain HTTP.
