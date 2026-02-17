# FEBRUARY11

Dark-themed OBS WebSocket mission control + self-hosted streaming automation platform. Built for Twitch streamers who want full control over their production — overlays, alerts, chat, VTuber avatar, scene automation, replay direction, and more.

> Two servers, one system: a **Node/TypeScript backend** for OBS control and orchestration + a **Python/Flask sidecar** for overlays, Twitch integration, and real-time stream visuals.

## Current Status

`v0.1.0` — All core phases complete. Active development.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    FEBRUARY11 System                     │
├────────────────────────┬────────────────────────────────┤
│   Node/TypeScript      │   Python/Flask Sidecar         │
│   Backend (port 3199)  │   OBS-Overlays (port 5555)     │
├────────────────────────┼────────────────────────────────┤
│ • OBS WebSocket v5     │ • Browser-source overlays      │
│ • Safety manager       │ • Twitch chat bot (twitchio)   │
│ • Chaos engine         │ • Alert system (follow/sub/    │
│ • Auto director        │   raid/bits/donations)         │
│ • Replay director      │ • Live chat overlay            │
│ • Plugin bridge        │ • Stats bar overlay            │
│ • Copilot Lab (AI)     │ • Keyboard visualizer          │
│ • Mission Control UI   │ • Live subtitles               │
│ • Overlay bridge       │ • VRM Avatar (Three.js)        │
│                        │ • Webcam tracker (MediaPipe)   │
│                        │ • Sound board system           │
│                        │ • Goal tracker overlay         │
│                        │ • Chat-triggered chaos effects │
│                        │ • Auto-clip (Twitch Helix API) │
│                        │ • Post-stream report generator │
│                        │ • Web-based config editor      │
│                        │ • Twitch EventSub polling      │
│                        │ • Stream control dashboard     │
│                        │ • SQLite event logging         │
└────────────────────────┴────────────────────────────────┘
```

```
backend/        Node API + OBS manager + Safety + Chaos + Auto + Replay + Plugin + AI Assistant
frontend/       Dark mission-control dashboard (vanilla JS/CSS)
shared/         Cross-module TypeScript contracts
presets/        Chaos presets + Auto Director rules + Plugin permissions
OBS-Overlays/   Python sidecar: overlays + Twitch bot + stream control
tests/          Node test suites
scripts/        Setup + load/stability testing
docs/           Setup guides, feature docs, troubleshooting
```

## What's In The Box

### OBS-Overlays (Python Sidecar — port 5555)

These are the overlays you add as **OBS Browser Sources**:

| Overlay | URL | What It Does |
|---------|-----|-------------|
| **Unified Scene** | `/overlay/scene` | Full 1920x1080 composite: alerts + chat + stats + ticker |
| **Alerts** | `/overlay/alerts` | Animated follow/sub/raid/bits/donation alerts with sound + particles |
| **Chat** | `/overlay/chat` | Twitch chat with user colors, badges, fade animations |
| **Stats Bar** | `/overlay/stats` | Live viewer count, followers, subs, messages, uptime |
| **Keyboard** | `/overlay/keyboard` | Translucent full keyboard that lights up as you type |
| **Subtitles** | `/overlay/subtitles` | Real-time subtitle renderer with runtime style updates |
| **VRM Avatar** | `/overlay/avatar` | 3D VTuber avatar (Three.js + @pixiv/three-vrm) |
| **Webcam Tracker** | `/overlay/tracker` | Open in browser — feeds webcam to avatar via MediaPipe |
| **Sound Board** | `/overlay/soundboard` | Sound effect notifications with animated popups |
| **Goal Tracker** | `/overlay/goals` | Animated progress bars for follower/sub/donation/bits goals |
| **Chaos Effects** | `/overlay/chaos` | 8 fullscreen visual effects triggered by chat or dashboard |

Plus:
- **Control Dashboard** at `/dashboard` — test alerts, avatar controls, sound board, goal tracking, chaos triggers, subtitle STT, clip creation
- **Post-Stream Report** at `/api/report/html` — auto-generated summary with timeline, top chatters, event breakdown, goal progress
- **Config Editor** at `/config` — web-based `.env` editor with grouped fields and secret masking
- **Twitch Chat Bot** — `!scene`, `!stats`, `!uptime`, `!so`, `!sound`, `!chaos`, `!clip` commands
- **Auto-Clip** — triggers on chat activity spikes, calls Twitch Helix Create Clip API
- **Sound Board** — auto-scans `static/sounds/soundboard/`, playable from dashboard or chat
- **EventSub Polling** — follower/viewer tracking via Twitch Helix API
- **SQLite Database** — all stream events logged locally

### Backend (Node/TypeScript — port 3199)

The mission control brain:

- **OBS Session Manager** — WebSocket v5 connection with auto-reconnect, backoff, jitter, typed status snapshots
- **Safety Manager** — kill switch to halt all automation + sliding-window action rate limiter
- **Chaos Engine** — preset-driven OBS automation: serial/parallel timelines, scene/filter/transform actions, cooldowns
- **Auto Director** — audio-level-driven automatic scene switching with hysteresis, hold windows, priority rules
- **Replay Director** — capture replay buffer, auto-play media source, branded lower-third, optional chapter markers
- **Plugin Bridge** — permission-checked OBS vendor plugin calls (allow/deny per vendor/request/role)
- **Overlay Bridge** — HTTP bridge to the Python sidecar (probes health, forwards test actions, manages URLs)
- **Copilot Lab** — onboarding wizard (scan OBS → generate configs → verify) + AI assistant planner with optional OpenAI integration
- **Mission Control Dashboard** — dark-themed operator UI with collapsible sections, keyboard shortcuts, quick actions, embedded overlay view

### VRM Avatar System

A VTuber-style avatar that mirrors your face and body movements in real-time:

1. **Tracker page** (`/overlay/tracker`) — open in your regular browser, uses your webcam
   - MediaPipe Holistic: face (468 landmarks), pose (33), hands (21)
   - Kalidokit: converts landmarks to VRM bone rotations
   - Sends rig data to server via Socket.IO
2. **Avatar overlay** (`/overlay/avatar`) — add as OBS Browser Source
   - Loads VRM model via Three.js + @pixiv/three-vrm
   - Receives rig data via Socket.IO relay (no webcam needed in OBS)
   - Maps face → head/neck bones + blink/mouth expressions
   - Maps pose → hips/spine/arms
   - Maps hands → finger bones
   - Falls back to procedural idle animations (breathing, sway, blink, look-around) when tracker is disconnected
3. **API control** — trigger expressions and motions from stream events
   - Reacts to follows (wave + happy), subs (nod + happy), raids (wave + surprised)
   - Occasional chat nods

## Quick Start

### 1. Install & Configure

```bash
# Clone and install Node dependencies
git clone https://github.com/lalomorales22/OBS-Websocket-Dashboard.git
cd OBS-Websocket-Dashboard
npm install

# Create local env config
cp .env.example .env
# Edit .env with your OBS host/port/password and Twitch credentials

# Setup Python overlay server
npm run overlays:setup
```

### 2. Configure Twitch (for chat bot + alerts)

Edit `OBS-Overlays/config.py` with your Twitch credentials:
- **Client ID + Secret** from [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps)
- **OAuth Token** from [twitchtokengenerator.com](https://twitchtokengenerator.com) (scopes: `chat:read`, `chat:edit`)
- Your **channel name**

### 3. Configure OBS

- Enable WebSocket: **Tools → WebSocket Server Settings → Enable**
- Default port: `4455` (match this in your `.env`)
- Create at least: a main scene, a camera scene, and an emergency fallback scene

### 4. Run

```bash
# Terminal 1: Node backend (mission control)
npm run dev

# Terminal 2: Python overlay server
npm run overlays:serve
```

### 5. Open

| What | URL |
|------|-----|
| Mission Control | `http://localhost:3199` |
| Overlay Dashboard | `http://localhost:5555/dashboard` |
| VRM Tracker (browser) | `http://localhost:5555/overlay/tracker` |

### 6. Add OBS Browser Sources

Add these as Browser Sources in OBS:

| Source | URL | Size |
|--------|-----|------|
| Unified overlay | `http://localhost:5555/overlay/scene` | 1920×1080 |
| VRM Avatar | `http://localhost:5555/overlay/avatar` | 1920×1080 |
| Keyboard | `http://localhost:5555/overlay/keyboard` | 1280×420 |
| Subtitles | `http://localhost:5555/overlay/subtitles` | 1920×1080 |
| Goals | `http://localhost:5555/overlay/goals` | 1920×1080 |
| Chaos Effects | `http://localhost:5555/overlay/chaos` | 1920×1080 |
| Sound Board | `http://localhost:5555/overlay/soundboard` | 800×200 |

Or use individual overlays (alerts, chat, stats) separately — see the overlay dashboard for all URLs.

## NPM Scripts

| Script | What It Does |
|--------|-------------|
| `npm run dev` | Start Node backend with hot-reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled production build |
| `npm test` | Run test suite |
| `npm run overlays:setup` | Create Python venv + install dependencies |
| `npm run overlays:serve` | Launch the Python overlay server |
| `npm run setup:map-obs-names` | Map placeholder names in preset files to your OBS scene/source names |

## Chat Commands

| Command | Description | Who Can Use |
|---------|-------------|-------------|
| `!scene <name>` | Switch OBS scene | Mods + Broadcaster |
| `!stats` | Show stream stats in chat | Everyone |
| `!uptime` | Show stream uptime | Everyone |
| `!so <user>` | Shoutout a user | Mods + Broadcaster |
| `!sound [name]` | Play a sound effect (no arg = list available) | Everyone |
| `!chaos [preset]` | Trigger a chaos effect (no arg = list presets) | Everyone |
| `!clip` | Create a Twitch clip of the current moment | Everyone |

## API Surface

### Node Backend (port 3199)

**Core:**
`GET /api/health` · `GET /api/status` · `POST /api/obs/connect` · `POST /api/obs/disconnect` · `POST /api/obs/reconnect` · `GET /api/obs/scenes` · `POST /api/obs/program-scene` · `GET /api/obs/inputs` · `GET /api/obs/input-volume`

**Safety:**
`GET /api/safety/status` · `POST /api/safety/kill-switch` · `POST /api/safety/fallback-trigger`

**Chaos Engine:**
`GET /api/chaos/status` · `GET /api/chaos/presets` · `POST /api/chaos/reload` · `POST /api/chaos/presets/:id/run`

**Auto Director:**
`GET /api/auto-director/status` · `POST /api/auto-director/enable` · `POST /api/auto-director/disable` · `POST /api/auto-director/reload`

**Replay Director:**
`GET /api/replay/status` · `POST /api/replay/capture` · `POST /api/replay/hide-overlay`

**Plugin Bridge:**
`GET /api/plugins/status` · `GET /api/plugins/vendors` · `POST /api/plugins/reload` · `POST /api/plugins/call`

**Overlay Bridge:**
`GET /api/overlays/status` · `POST /api/overlays/probe` · `POST /api/overlays/test-alert` · `POST /api/overlays/test-chat` · `GET /api/overlays/scenes` · `POST /api/overlays/scene` · `POST /api/overlays/start-stream` · `POST /api/overlays/subtitles/*`

**AI Assistant:**
`GET /api/assistant/suggestions` · `POST /api/assistant/chat` · `POST /api/assistant/plan` · `POST /api/assistant/execute`

**Onboarding:**
`GET /api/onboarding/status` · `POST /api/onboarding/scan` · `POST /api/onboarding/generate` · `POST /api/onboarding/verify`

**WebSocket** at `/ws` — real-time state broadcasting for all subsystems.

### Python Sidecar (port 5555)

**Stream Control:**
`GET /api/stats` · `POST /api/test-alert` · `POST /api/test-chat` · `POST /api/scene` · `GET /api/scenes` · `GET /api/obs-status` · `POST /api/start-stream`

**Keyboard:**
`GET /api/keyboard/status` · `POST /api/keyboard/test`

**Subtitles:**
`GET /api/subtitles/state` · `GET|POST /api/subtitles/settings` · `POST /api/subtitles/push` · `POST /api/subtitles/clear`

**Avatar:**
`GET|POST /api/avatar/settings` · `POST /api/avatar/expression` · `POST /api/avatar/motion` · `GET /api/avatar/vrms`

**Sound Board:**
`GET /api/soundboard/sounds` · `POST /api/soundboard/play`

**Goals:**
`GET /api/goals` · `POST /api/goals/update` · `POST /api/goals/increment` · `POST /api/goals/reset`

**Chaos Effects:**
`GET /api/chaos/presets` · `POST /api/chaos/trigger`

**Clip:**
`POST /api/clip`

**Report:**
`GET /api/report` · `GET /api/report/html`

**Config:**
`GET|POST /api/config`

## Environment Variables

See `.env.example` for all available configuration. Key variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `APP_PORT` | `3199` | Node backend port |
| `OBS_HOST` | `127.0.0.1` | OBS WebSocket host |
| `OBS_PORT` | `4455` | OBS WebSocket port |
| `OBS_PASSWORD` | — | OBS WebSocket password |
| `SAFETY_FALLBACK_SCENE` | — | Emergency fallback scene name |
| `OVERLAY_BRIDGE_BASE_URL` | `http://127.0.0.1:5555` | Python sidecar URL |
| `OVERLAYS_SERVER_PORT` | `5555` | Python sidecar port |
| `OPENAI_API_KEY` | — | Enables AI assistant planning |

Full list of 35+ env vars in `.env.example`.

## Network Access

Both servers bind to `0.0.0.0` by default, so you can access them from other devices on your network (phone, tablet, etc.) using your machine's local IP address (e.g., `http://192.168.x.x:5555/dashboard`).

## Tech Stack

- **Node.js 20+** / **TypeScript** — backend, OBS WebSocket v5, Express API
- **Python 3.10+** / **Flask** / **Flask-SocketIO** — overlay server, Twitch bot
- **Three.js** + **@pixiv/three-vrm** — 3D VRM avatar rendering
- **MediaPipe Holistic** + **Kalidokit** — webcam face/body/hand tracking
- **twitchio** — Twitch chat IRC
- **obs-websocket-js** (v5) / **obs-websocket-py** — OBS control
- **pynput** — global keyboard capture
- **SQLite** — event logging

## Project Structure

```
├── backend/src/
│   ├── server.ts              # Express + WS entrypoint
│   ├── config.ts              # Typed env var config
│   ├── obs-manager.ts         # OBS WebSocket v5 manager
│   ├── safety-manager.ts      # Kill switch + rate limiter
│   ├── chaos-engine.ts        # Preset automation executor
│   ├── auto-director.ts       # Audio-driven scene switcher
│   ├── replay-director.ts     # Replay buffer + lower-thirds
│   ├── plugin-bridge.ts       # OBS vendor plugin permissions
│   ├── overlay-bridge.ts      # Python sidecar bridge
│   ├── onboarding-service.ts  # First-run OBS setup wizard
│   ├── logger.ts              # Structured JSON logger
│   ├── errors.ts              # Error types
│   └── assistant/             # AI assistant subsystem
│       ├── assistant-service.ts
│       ├── tool-registry.ts
│       ├── prompt.ts
│       └── llm-planner.ts
├── frontend/
│   ├── index.html             # Mission Control dashboard
│   ├── app.js                 # Dashboard client logic
│   └── styles.css             # Dark theme styles
├── shared/src/
│   └── types.ts               # Shared TypeScript contracts
├── OBS-Overlays/
│   ├── server.py              # Flask + SocketIO server (~1700 lines)
│   ├── config.py              # Twitch/OBS/overlay config
│   ├── requirements.txt       # Python dependencies
│   ├── setup.sh               # Venv setup script
│   ├── templates/
│   │   ├── dashboard.html     # Full control panel (alerts, avatar, sounds, goals, chaos, clips, STT)
│   │   ├── scene.html         # Unified 1920x1080 overlay
│   │   ├── alerts.html        # Alert animations (follow/sub/raid/bits/donation)
│   │   ├── chat.html          # Chat display
│   │   ├── stats.html         # Stats bar
│   │   ├── keyboard.html      # Keyboard visualizer
│   │   ├── subtitles.html     # Live subtitles
│   │   ├── avatar.html        # VRM avatar renderer
│   │   ├── tracker.html       # Webcam capture → Socket.IO
│   │   ├── soundboard.html    # Sound effect notification overlay
│   │   ├── goals.html         # Goal tracker progress bars
│   │   ├── chaos.html         # Chaos effects (8 visual presets)
│   │   ├── report.html        # Post-stream report page
│   │   └── config_ui.html     # Web-based .env config editor
│   └── static/
│       ├── VRMs/              # VRM avatar files
│       └── sounds/
│           ├── soundboard/    # Sound board effects (auto-scanned)
│           └── *.mp3          # Alert sound files
├── presets/
│   ├── chaos/                 # Chaos automation presets
│   ├── scene-blueprints/      # Generated scene configs
│   ├── overlays/              # Overlay presets
│   ├── auto-director.*.json   # Auto director rules
│   └── plugin-permissions.*.json
├── tests/                     # Node test suites
├── scripts/                   # Setup + load testing
└── docs/                      # Documentation
```

## License

MIT

## Author

**Lalo Morales** — [github.com/lalomorales22](https://github.com/lalomorales22)
