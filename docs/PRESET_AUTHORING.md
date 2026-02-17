# Preset Authoring Guide

Chaos presets live in `presets/chaos` and must be valid JSON files.

## Minimal Preset

```json
{
  "id": "camera_cut",
  "name": "Camera Cut",
  "description": "Instant scene switch",
  "cooldownMs": 1500,
  "tags": ["camera", "cut"],
  "steps": [
    { "type": "setProgramScene", "sceneName": "Camera Close" }
  ]
}
```

## Top-Level Fields

- `id` (string): unique preset id.
- `name` (string): display name in UI.
- `description` (string, optional): operator context.
- `cooldownMs` (number, optional): lockout after run.
- `tags` (string[]): optional grouping labels.
- `steps` (array): one or more executable steps.

## Supported Step Types

- `serial`
  - Runs `steps` in order.
- `parallel`
  - Runs `steps` concurrently.
- `sleep`
  - Use `ms` or `frames`.
- `setProgramScene`
  - Requires `sceneName`.
- `setPreviewScene`
  - Requires `sceneName`.
- `sceneTransition`
  - Optional `transitionName`, `durationMs`, `triggerStudioMode`.
- `sceneItemTransform`
  - Requires `sceneName`, and either `sceneItemId` or `sceneItemSourceName`.
- `sceneItemEnabled`
  - Requires `sceneName`, `enabled`, and either `sceneItemId` or `sceneItemSourceName`.
- `sourceFilter`
  - Requires `sourceName`, `filterName`, optional `enabled`, `settings`, `overlay`.
- `obsRequest`
  - Raw request bridge with `requestType` + `requestData`.
- `batch`
  - Multiple OBS calls with optional `executionType` and `haltOnFailure`.

## Example: Kinetic Intro

```json
{
  "id": "kinetic_intro",
  "name": "Kinetic Intro",
  "cooldownMs": 5000,
  "steps": [
    {
      "type": "serial",
      "steps": [
        { "type": "setPreviewScene", "sceneName": "Wide" },
        {
          "type": "sceneTransition",
          "transitionName": "Swipe",
          "durationMs": 450,
          "triggerStudioMode": true
        },
        {
          "type": "parallel",
          "steps": [
            {
              "type": "sourceFilter",
              "sourceName": "Gameplay",
              "filterName": "Color Punch",
              "enabled": true
            },
            {
              "type": "sceneItemTransform",
              "sceneName": "Wide",
              "sceneItemSourceName": "Facecam",
              "transform": { "positionX": 1280, "positionY": 600, "scaleX": 1.07, "scaleY": 1.07 }
            }
          ]
        },
        { "type": "sleep", "frames": 2 },
        { "type": "setProgramScene", "sceneName": "Wide" }
      ]
    }
  ]
}
```

## Authoring Tips

- Keep first versions short and deterministic.
- Add a non-zero `cooldownMs` for high-impact presets.
- Use `sceneItemSourceName` where possible for portability.
- Validate with `POST /api/chaos/reload` before running live.
- Keep a fallback scene configured in `.env`.

