# Setup Guide

This guide takes you from a clean machine to a running `FEBRUARY11` dashboard.

## Prerequisites

- `Node.js` 20+ (`node -v`)
- `npm` 10+
- OBS Studio with WebSocket 5.x support enabled

## 1. Install Dependencies

```bash
npm install
```

## 2. Create Local Environment File

```bash
cp .env.example .env
```

Set at least these values in `.env`:

- `OBS_HOST`
- `OBS_PORT`
- `OBS_PASSWORD` (if configured in OBS)
- `SAFETY_FALLBACK_SCENE` (recommended)

For replay workflows, also set:

- `REPLAY_MEDIA_INPUT_NAME`
- `REPLAY_LOWER_THIRD_INPUT_NAME`
- `REPLAY_LOWER_THIRD_SCENE_NAME`

## 3. Configure OBS WebSocket

In OBS:

1. Open `Tools -> WebSocket Server Settings`.
2. Enable the server.
3. Match server port/password to your `.env`.
4. Save settings.

## 4. Start FEBRUARY11

```bash
npm run dev
```

Open:

- Dashboard: `http://localhost:3199`
- Health check: `http://localhost:3199/api/health`

## 5. Verify Connection

When the backend connects successfully:

- `/api/status` shows `connection.phase: "connected"`
- Dashboard OBS status panel updates live

## Optional: Run OBS-Overlays Sidecar

If you want the integrated overlay app inside Mission Control:

```bash
npm run overlays:setup
```

Then run sidecar service (separate terminal):

```bash
npm run overlays:serve
```

Then in FEBRUARY11 dashboard:

- use `Probe Overlay Service`
- use `Auto-Detect + Copy URLs` to copy overlay browser-source URLs
- use `Load Overlay Dashboard` (embedded in Mission Control)
- use `Load Unified Overlay` (embedded in Mission Control)
- use `Open Current in New Tab` if you want the overlay app standalone
- copy overlay URLs into OBS browser sources

## Optional: Mission Control Layout Controls

- Each top-level section supports `Collapse` / `Expand`.
- `Live Operations` collapses Connection through Performance as one unit.
- Quickbar actions:
  - `Compact View` collapses all top-level sections
  - `Full View` expands all top-level sections

## Build and Run (Production Style)

```bash
npm run build
npm run start
```

## Test and Coverage

```bash
npm test
npm run test:coverage
```

## Load and Stability Scripts

```bash
npm run load:event-burst
npm run load:reconnect-storm
```

Use environment variables to tune them:

- `BASE_URL`
- `BURSTS`, `CONCURRENCY`, `PAUSE_MS`
- `CYCLES`, `MODE`, `VERIFY_EVERY`
