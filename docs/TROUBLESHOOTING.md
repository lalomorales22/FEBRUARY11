# Troubleshooting FAQ

## OBS never reaches `connected`

Checklist:

- Confirm OBS is running.
- Confirm WebSocket server is enabled in OBS.
- Confirm `OBS_HOST`, `OBS_PORT`, and `OBS_PASSWORD` match OBS settings.
- Check `/api/status` and `/api/health` for reconnect attempts.

## Dashboard loads but panels do not update

- Verify backend is running on the same `APP_PORT`.
- Confirm browser can reach `/ws`.
- Check browser console for WebSocket errors.
- Confirm reverse proxy rules (if any) allow WebSocket upgrades.

## Chaos preset run returns `CHAOS_PRESET_NOT_FOUND`

- Confirm file is in `presets/chaos`.
- Confirm JSON file has `.json` extension.
- Reload with `POST /api/chaos/reload`.
- Verify preset `id` matches the route parameter exactly.

## Chaos preset fails with `No source was found by the name of CAM_MAIN`

Default presets ship with placeholder names such as:

- `CAM_MAIN`
- `GAMEPLAY`
- `CAM_REACT`
- `FaceCam`

Fix options:

- Rename your OBS scenes/sources to match those placeholders, or
- Map placeholders to your names:
  ```bash
  OBS_MAIN_SCENE_NAME="Camera" \
  OBS_GAMEPLAY_SCENE_NAME="Gameplay" \
  OBS_REACT_SCENE_NAME="Camera React" \
  OBS_FACECAM_SOURCE_NAME="Facecam" \
  npm run setup:map-obs-names
  ```

Then reload runtime configs:

- `POST /api/chaos/reload`
- `POST /api/auto-director/reload`

## Chaos or Auto Director actions are blocked

- Check kill switch: `GET /api/safety/status`.
- Check rate-limit window counters in safety status.
- If needed, temporarily disable kill switch from dashboard or:
  - `POST /api/safety/kill-switch` with `{ "enabled": false }`

## Auto Director shows `no-candidate`

- Confirm Auto Director is enabled and rules were reloaded:
  - `POST /api/auto-director/reload`
  - `POST /api/auto-director/enable`
- In dashboard, check `Top Input Levels` under Auto Director.
  - If this stays `-`, OBS input meter events are not coming through.
  - If names appear but do not match your rule `inputName`, update rules.
- Rule matching is case-insensitive, but names must still reference real OBS mixer inputs.
- Lower thresholds for testing:
  - set `activationDb` around `-55`
  - set `holdMs` to `0-300`
- If current program scene already equals the winning rule scene, status may show `scene-already-live`.

## Replay capture fails

- Ensure replay buffer is enabled in OBS output settings.
- If `REPLAY_AUTO_START_BUFFER=false`, start replay buffer manually.
- Confirm permission to write to replay output directory in OBS.
- Check replay status in `GET /api/replay/status`.

## Lower-third replay overlay does not appear

- Verify `REPLAY_LOWER_THIRD_INPUT_NAME` is exact source name.
- Verify `REPLAY_LOWER_THIRD_SCENE_NAME` contains that source.
- Confirm source type supports `SetInputSettings` text updates.

## Plugin call denied with `PLUGIN_PERMISSION_DENIED`

- Check `presets/plugin-permissions.default.json`.
- Confirm vendor name, request type, and role are allowed.
- Reload permissions via `POST /api/plugins/reload`.
- Review `GET /api/plugins/status` for last error details.

## Reconnect storms during live show

- Use `npm run load:reconnect-storm` in staging first.
- Increase reconnect backoff:
  - `OBS_RECONNECT_BASE_MS`
  - `OBS_RECONNECT_MAX_MS`
- Validate local network stability between OBS and control machine.

## Overlay bridge shows unreachable

- Ensure `OBS-Overlays` server is running (`npm run overlays:serve`).
- Verify `OVERLAY_BRIDGE_BASE_URL` matches the actual host/port.
- Click `Probe Overlay Service` in dashboard.
- Check `OVERLAY_BRIDGE_REQUEST_TIMEOUT_MS` if your sidecar responds slowly.

## OBS-Overlays dashboard says "No scenes found"

- If FEBRUARY11 is connected to OBS, keep `OBS_PROXY_VIA_FEBRUARY11=true` and run overlays using:
  - `npm run overlays:serve`
- This launch path injects `.env` values and enables fallback scene lookup through:
  - `GET /api/obs/scenes`
  - `POST /api/obs/program-scene`
- In OBS-Overlays dashboard, click `Load Scenes from OBS` again.
