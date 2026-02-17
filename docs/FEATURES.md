# Feature Guide

## Core Modules

### OBS Session Manager

- Connects to OBS WebSocket 5.x
- Reconnects with exponential backoff + jitter
- Maintains live stream/record/scene/stats snapshot
- Exposes snapshot via REST and `/ws`

### Safety Manager

- Kill switch to block automation calls instantly
- Action rate limiting over a moving window
- Fallback scene trigger endpoint for emergency recovery

### Chaos Engine

- Loads presets from `presets/chaos/*.json`
- Supports serial and parallel action timelines
- Supports frame-based and millisecond delays
- Supports scene, transition, source filter, transform, and batch OBS actions
- Enforces per-preset cooldowns

### Auto Director

- Subscribes to `InputVolumeMeters`
- Chooses active rule by priority + audio level
- Uses hysteresis and hold windows to avoid flapping
- Applies switch cooldown to prevent rapid scene churn

### Replay Director

- Saves replay buffer clips
- Reads latest replay path from OBS
- Optionally loads clip into a media source and restarts playback
- Updates lower-third text and timed visibility
- Optionally creates recording chapters

### Plugin Bridge

- Wraps `CallVendorRequest`
- Uses permission registry from JSON
- Enforces role/request/vendor allow list
- Tracks recent vendor events for operator visibility

### OBS Overlays Bridge

- Integrates with the `OBS-Overlays` Flask service
- Checks upstream reachability and exposes status in dashboard
- Provides overlay links for dashboard/scene/alerts/chat/stats views
- Adds auto-detect + copy helper for OBS browser-source URLs
- Supports embedded stream-control/overlay view directly in Mission Control
- Uses fit/scaled iframe mode for cleaner in-app rendering
- Forwards test alert/test chat/scene switch/start-stream calls
- Supports OBS-Overlays fallback via FEBRUARY11 scene endpoints

### Dashboard UX

- Dark mission-control layout
- Quick actions for high-frequency tasks
- Top-level `Collapse`/`Expand` control per dashboard section
- `Live Operations` group section for Connection through Performance (single collapse control)
- Quickbar `Compact View` and `Full View` toggles
- Collapse state persisted in browser local storage
- Keyboard shortcuts:
  - `Ctrl+Shift+R` replay capture
  - `Ctrl+Shift+K` kill switch
  - `Ctrl+Shift+A` auto director toggle
- Confirmation prompts for risky operations
- Stream-safe toast notifications
