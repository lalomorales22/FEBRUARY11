# FEBRUARY11 — Tasks & Roadmap

> Last updated: 2026-02-18

---

## Legend

- `[x]` — Done and working
- `[~]` — Partially implemented / needs fixing
- `[ ]` — Not started
- `[!]` — Was working before, now missing or broken (recovered from old READMEs/docs)

---

## Phase 1 — Foundation (COMPLETE)

- [x] OBS WebSocket v5 connection manager with auto-reconnect + exponential backoff
- [x] Health + status REST API
- [x] WebSocket snapshot broadcasting to dashboard
- [x] Safety manager — kill switch + action rate limiter
- [x] Dark-themed Mission Control dashboard shell
- [x] Express server with static frontend serving

## Phase 2 — Orchestration (COMPLETE)

- [x] Chaos Engine — preset loader/executor with serial/parallel timelines
- [x] Auto Director — audio-level-driven scene switching with hysteresis + hold windows
- [x] Fallback scene safety trigger
- [x] Two chaos presets shipped (kinetic-slam, studio-whip)
- [x] Preset authoring system documented (docs/PRESET_AUTHORING.md)

## Phase 3 — Production Tooling (COMPLETE)

- [x] Replay Director — capture workflow with lower-third overlays
- [x] Plugin Bridge — guarded vendor request execution with permission registry
- [x] Dashboard quick actions (replay, kill switch, auto director, chaos)
- [x] Keyboard shortcuts (Ctrl+Shift+R/K/A)
- [x] Confirmation prompts for risky operations
- [x] Toast notifications

## Phase 4 — Hardening & OSS (COMPLETE)

- [x] Node test suite (safety, chaos, auto-director, plugin bridge, config)
- [x] Load/stability scripts (event burst, reconnect storm)
- [x] Documentation set (SETUP, FEATURES, PRESET_AUTHORING, TROUBLESHOOTING)
- [x] MIT license
- [x] OBS-Overlays bridge integration (status, test actions, overlay links)
- [x] Overlay URL auto-detect + copy helper
- [x] OBS-Overlays fallback through FEBRUARY11 scene APIs

## Phase 5 — Overlays & Twitch (COMPLETE)

- [x] Flask + SocketIO overlay sidecar (port 5555)
- [x] Unified 1920x1080 scene overlay (alerts + chat + stats + ticker)
- [x] Alert system — follow/sub/raid with animations, particles, sound
- [x] Live chat overlay — user colors, badges, fade animations
- [x] Stats bar — viewers, followers, subs, messages, uptime
- [x] Keyboard visualizer — translucent full keyboard
- [x] Live subtitles — real-time renderer with API-driven styling
- [x] Twitch chat bot (twitchio) — !scene, !stats, !uptime, !so
- [x] EventSub polling — follower/viewer tracking from Twitch Helix API
- [x] Auto-clip detection — chat activity spike trigger
- [x] Overlay control dashboard with test buttons
- [x] SQLite event logging
- [x] Twitch credential setup flow documented

## Phase 6 — VRM Avatar (COMPLETE)

- [x] VRM model loading via Three.js + @pixiv/three-vrm
- [x] Procedural idle animations (breathing, sway, blink, look-around)
- [x] Webcam tracker page (MediaPipe Holistic + Kalidokit)
- [x] Socket.IO relay architecture — tracker sends rig data, avatar receives
- [x] Face tracking — head rotation, blink, pupil direction, mouth visemes
- [x] Pose tracking — hips, spine, upper/lower arms
- [x] Hand tracking — all 5 fingers × 3 segments + wrist
- [x] Lerp smoothing on all bone rotations
- [x] Automatic fallback to idle when tracker disconnects (3s timeout)
- [x] Stream event reactions — follows (wave), subs (nod), raids (surprised)
- [x] Avatar settings API — runtime config for VRM path, camera, lerp factors
- [x] Expression + motion API — trigger from any external system
- [x] VRM file listing API
- [x] Tracker page UI with live stats (FPS, face/pose/hand detection, socket status)

## Phase 7 — Copilot Lab (COMPLETE)

- [x] Onboarding wizard — scan OBS, generate configs, verify
- [x] AI assistant planner — natural language → tool plans
- [x] Rule-based prompt parsing fallback (works without OpenAI key)
- [x] Optional OpenAI API integration for LLM-powered planning
- [x] 10 registered tools (obs.connect, chaos.run-preset, replay.capture, etc.)
- [x] Plan preview before execution
- [x] Dashboard UI for onboarding + assistant

---

## KNOWN ISSUES / PARTIALLY IMPLEMENTED

- [~] **Raspberry Pi compatibility** — The old README mentioned Raspberry Pi 500 support. The Python sidecar should work fine, but the Node backend + Three.js avatar may need testing on ARM.

Previously open — now resolved:

- [x] **STT subtitle pipeline** — Web Speech API on overlay dashboard pushes live to subtitle overlay. Start/stop buttons, auto-restart on disconnect, interim + final results.
- [x] **Overlay dashboard controls** — Dashboard now has avatar control (VRM switch, expressions, motions), subtitle push/clear/STT, soundboard, goals, chaos, clip button.
- [x] **Bits/donation alerts** — Full CSS styling, amount display, test buttons, sounds for bits and donation alert types.
- [x] **Auto-clip actually creating clips** — Now calls Twitch Helix Create Clip API. Also has `!clip` chat command and dashboard button. Requires OAuth token with `clips:edit` scope.

---

## Phase 8 — Engagement & Tooling (COMPLETE)

- [x] Bits/donation alert types with CSS, sounds, amount display, and test buttons
- [x] Avatar controls on overlay dashboard — VRM switch dropdown, expression buttons, motion triggers
- [x] STT subtitle pipeline — Web Speech API on dashboard, push to subtitle overlay, start/stop buttons
- [x] Avatar outfit hot-swap — VRM listing API + dashboard dropdown, runtime model switching
- [x] Sound board — auto-scan static/sounds/soundboard/, dashboard buttons, `!sound` chat command, overlay notifications, cooldown system
- [x] Goal tracker overlay — follower/sub/donation/bits progress bars, dashboard controls, auto-increment from follow events, reset API
- [x] Chat-triggered chaos presets — 8 effects (disco, earthquake, confetti, matrix, rave, glitch, hearts, jumpscare), `!chaos` chat command, dashboard buttons, overlay template
- [x] Post-stream report — SQLite query for event counts, top chatters, timeline, goal progress, sounds/chaos used. Pretty HTML report page at `/api/report/html`
- [x] Config UI — web-based `.env` editor at `/config`, reads/writes config, secret masking, grouped fields
- [x] Auto-clip wired to Twitch Helix Create Clip API — `!clip` chat command, dashboard button, auto-clip on chat spike

---

## RECOVERED IDEAS (from previous READMEs/docs that describe features worth building)

These are cool ideas mentioned in earlier versions of the project that could be built:

### Overlay Enhancements

- [x] **Goal tracker overlay** — sub goal, follower goal, donation goal with animated progress bars
- [ ] **Now Playing overlay** — Spotify/YouTube Music integration showing current track with album art
- [ ] **Countdown/timer overlay** — configurable countdown for stream start, breaks, events
- [ ] **Emote wall overlay** — large emotes flying across screen when chat spams them
- [ ] **Notification queue** — stack alerts instead of dropping concurrent ones, with smooth transitions
- [ ] **Custom alert builder** — dashboard UI to create alert templates (text, sound, animation, duration) without code

### Avatar Improvements

- [ ] **Phone as webcam tracker** — the tracker page works on phones via local IP, but needs HTTPS for getUserMedia. Add a self-signed cert generator script or ngrok integration guide
- [x] **Avatar outfit/model hot-swap** — switch VRM models at runtime from the dashboard without reloading the overlay
- [ ] **Avatar props** — hold items, wear accessories that can be triggered from chat commands
- [ ] **Avatar lip sync from audio** — use mic input audio levels to drive mouth movement instead of (or alongside) visual mouth tracking
- [ ] **Avatar green screen mode** — solid green background option for easy chroma-key compositing
- [ ] **Avatar scene presets** — save/load camera angles, lighting setups, background colors per scene
- [ ] **Multiple avatar support** — load 2+ VRM models for collab streams, each driven by different tracker instances
- [ ] **Avatar dance/emote system** — pre-built animations triggered by chat commands (!dance, !wave, !dab)

### Stream Intelligence

- [ ] **Chat sentiment analysis** — real-time mood tracking (positive/negative/hype/chill) displayed as a dashboard widget
- [ ] **Viewer engagement score** — composite metric from chat rate, follows, subs, emote usage
- [ ] **Stream highlight detection** — automatically mark moments where chat+audio both spike
- [x] **Post-stream report** — auto-generate a summary: peak viewers, top chatters, follower count delta, clip timestamps, hype moments
- [ ] **Chat word cloud** — real-time word frequency visualization overlay
- [ ] **Raid analytics** — track incoming/outgoing raids, viewer retention after raids

### Automation & Control

- [ ] **Scheduled scenes** — time-based scene switching (BRB screen at specific times, countdown for stream start)
- [x] **Chat-triggered chaos presets** — let viewers vote on or trigger chaos presets via channel points or chat commands
- [ ] **Macro recorder** — record a sequence of manual actions (scene switches, filter toggles) and save as a chaos preset
- [x] **Sound board** — trigger sound effects from dashboard or chat commands, displayed on the overlay
- [ ] **Scene transition builder** — visual editor for creating custom stinger transitions
- [ ] **Multi-stream support** — push overlays to multiple streaming platforms simultaneously
- [ ] **Remote control mobile app** — dedicated mobile UI (not just the dashboard) optimized for phone-sized touch controls

### Integration Ideas

- [ ] **Discord integration** — post go-live notifications, chat bridge, mod alerts
- [ ] **Streamlabs/StreamElements import** — migrate existing alert configs, overlays, and chat commands
- [ ] **Twitch channel point rewards** — custom reward handlers that trigger chaos presets, avatar emotes, or scene changes
- [ ] **YouTube/Kick chat support** — multi-platform chat aggregation into one overlay
- [ ] **Webhook system** — POST to external URLs on stream events (for IFTTT, Zapier, custom bots)
- [ ] **OBS scene collection import** — read OBS scene collection JSON and auto-generate matching auto-director rules + chaos presets

### Developer Experience

- [ ] **Plugin system** — allow third-party overlay plugins (npm packages or git repos) that register routes, templates, and socket events
- [ ] **Overlay theme engine** — CSS variable system for one-click theme switching across all overlays
- [ ] **Hot reload for overlays** — file watcher that auto-refreshes browser sources when templates change
- [x] **Config UI** — web-based config editor instead of editing .env and config.py manually
- [ ] **Overlay preview mode** — render all overlays in a single preview page with mock data, no OBS needed
- [ ] **API playground** — Swagger/OpenAPI docs or built-in API tester in the dashboard

---

## PRIORITY PICKS — ALL COMPLETE ✅

All 8 original priority picks have been implemented:

1. ~~**Avatar outfit hot-swap**~~ ✅ — VRM dropdown on dashboard, runtime switching
2. ~~**Sound board**~~ ✅ — dashboard + `!sound` chat command + overlay notifications
3. ~~**Chat-triggered chaos presets**~~ ✅ — 8 effects, `!chaos` chat command, overlay template
4. ~~**Goal tracker overlay**~~ ✅ — animated progress bars, auto-increment, dashboard controls
5. ~~**Post-stream report**~~ ✅ — HTML report page with timeline, top chatters, event breakdown
6. ~~**Config UI**~~ ✅ — web-based .env editor at `/config`
7. ~~**STT reliability fixes**~~ ✅ — Web Speech API on overlay dashboard with auto-restart
8. ~~**Auto-clip actually clipping**~~ ✅ — Twitch Helix Create Clip API, `!clip` command

### Suggested next priorities:

1. **Now Playing overlay** — Spotify/YouTube Music integration
2. **Countdown/timer overlay** — configurable for stream start, breaks
3. **Emote wall overlay** — large emotes when chat spams them
4. **Chat sentiment analysis** — real-time mood tracking widget
5. **Discord integration** — go-live notifications, chat bridge
6. **Phone as webcam tracker** — HTTPS setup for mobile tracker page
7. **Notification queue** — stack alerts with smooth transitions
8. **Overlay theme engine** — CSS variables for one-click theme switching

---

## ARCHITECTURE NOTES

Things to keep in mind for future development:

- **Overlay pattern**: each overlay is a self-contained Jinja2 HTML template with inline CSS, Socket.IO for real-time data, transparent background for OBS. Add new overlays by: creating `templates/name.html`, adding `@app.route("/overlay/name")` in server.py, adding to dashboard URL list, and adding to overlay-bridge.ts.

- **Two-server boundary**: the Node backend handles OBS WebSocket control and orchestration. The Python sidecar handles Twitch/chat/overlays/visual. They communicate via HTTP bridge (overlay-bridge.ts → Flask API). Socket.IO is Python-side only.

- **Safety first**: all OBS mutations in the Node backend go through `SafetyManager.assertAction()`. New automation features should respect the kill switch and rate limiter.

- **Config sources**: Node reads `.env` via `config.ts`. Python reads `config.py` directly. Both support environment variable overrides. Consider unifying into a single config source eventually.

- **Shared types**: `shared/src/types.ts` defines all cross-module contracts. New WebSocket message types should be added to the `WsServerMessage` discriminated union.
