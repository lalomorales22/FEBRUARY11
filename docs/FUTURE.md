# FUTURE.md

## FEBRUARY11 V2 Vision

Build the "I don't want to learn OBS" app:

- user installs app
- app discovers OBS setup
- app builds scenes/overlays/automations
- user talks to an assistant in plain English
- user goes live faster with less risk

This V2 should feel like a complete streaming copilot, not just a control panel.

## Product Goal

Make FEBRUARY11 worth a **$20 one-time purchase** by removing setup pain and reducing live-stream mistakes.

## What V1 Does Well (Keep)

- reliable OBS WebSocket control + reconnect logic
- safety controls (kill switch, fallback, guard rails)
- automation engines (chaos, auto-director, replay)
- plugin permission model
- overlays integration + embedded dashboard

## What V2 Must Fix

- too much operator knowledge required
- unclear "what button does what"
- OBS naming/setup friction
- too many manual steps to get production-ready

---

## V2 Pillars

### 1. Zero-Config Onboarding Wizard

Goal: get from fresh install to stream-ready in 10 minutes.

Core flow:

1. Connect to OBS WebSocket.
2. Detect scenes, sources, filters, audio inputs.
3. Ask user 5-7 plain-language questions (stream type, camera setup, game capture style, alert style).
4. Auto-generate:
   - scene recommendations
   - auto-director rules
   - replay settings
   - safety defaults
5. Write generated profiles to project files:
   - `presets/auto-director.generated.json`
   - `presets/scene-blueprints/default.json`
   - `presets/overlays/default.json`
6. Run a guided verification checklist ("test mic", "test scene switch", "test replay").

### 2. AI Assistant (In-App, Actionable)

Add an assistant panel that can understand commands and execute safe actions.

Examples:

- "Set up a clean Just Chatting layout with camera large and chat right."
- "Make auto director faster."
- "Create a BRB overlay with neon style and countdown."
- "I want replay to show lower third for 4 seconds."
- "Why is auto-director not switching?"

Proposed backend pieces:

- `backend/src/assistant/assistant-service.ts`
- `backend/src/assistant/tool-registry.ts`
- `backend/src/assistant/prompt.ts`

Proposed API:

- `POST /api/assistant/chat`
- `POST /api/assistant/plan`
- `POST /api/assistant/execute`
- `GET /api/assistant/suggestions`

Execution model:

- assistant generates a structured action plan
- plan is shown to user before execution
- user can run full plan or step-by-step
- all actions go through safety manager + permission checks

### 3. Overlay Studio (Prompt -> Asset -> Live)

Goal: user can generate custom overlays without coding.

Features:

- prompt-based overlay generation ("cyberpunk follower alert, animated, transparent")
- produces editable overlay config JSON + HTML/CSS template
- live preview in dashboard
- one-click "apply to OBS scene as browser source"
- template marketplace-style presets

Files:

- `presets/overlays/*.json`
- `OBS-Overlays/templates/generated/*.html`
- `OBS-Overlays/static/generated/*.css`

### 4. Scene Blueprint Builder

Goal: build scenes automatically based on stream type.

Blueprint packs:

- Gaming Starter
- Facecam + Chat
- Podcast Duo
- IRL Minimal

Each pack defines:

- scenes to create
- required sources
- source transforms
- transitions
- optional overlays

Then assistant can "install blueprint" and map current device/input names.

### 5. Smart Automations 2.0

Beyond current auto-director:

- speaking detection with priority context
- reaction mode (chat spikes/alert events can trigger scene emphasis)
- segment macros ("Start Match", "Clutch Replay", "Post-Game Recap")
- health monitor automation:
  - if camera source disappears -> fallback scene
  - if dropped frames spike -> switch to safe profile
  - if OBS reconnect storm -> auto-throttle automations

### 6. Stream Coach + Explain Mode

Goal: every action tells user what happened and why.

Add:

- "Explain this panel" help mode
- "What changed?" timeline after automations
- confidence/safety badges before high-impact actions
- plain-language tooltips on all buttons

---

## "Worth $20" Value Stack

What users are buying:

- saved setup time (hours -> minutes)
- fewer live mistakes
- one app for control + overlays + automations + troubleshooting
- guided onboarding and one-click defaults
- AI-assisted scene/overlay creation

Positioning:

- one-time purchase for core desktop control
- optional future add-ons: cloud presets, overlay packs, AI quota bundles

---

## Suggested V2 Phases

### Phase A: UX Clarity + Guided Setup

- onboarding wizard
- contextual help/explain mode
- button/action labeling cleanup
- "safe mode" defaults for first-time users

### Phase B: Assistant + Action Plans

- assistant API integration
- tool-calling to existing endpoints
- preview/confirm execution pipeline
- audit log for assistant actions

### Phase C: Overlay Studio + Blueprint Packs

- prompt-to-overlay generator
- generated asset pipeline
- blueprint installer for scene stacks
- one-click OBS apply

### Phase D: Premium Polish + Commercial Packaging

- activation/licensing
- in-app updates/migrations
- crash reporting + anonymized diagnostics
- polished onboarding + sample packs

---

## Concrete "Next Build" Backlog

1. Add `assistant` backend module with tool abstractions over existing REST actions.
2. Add `Assistant` panel in frontend with:
   - chat
   - generated plan table
   - execute/cancel controls
3. Add onboarding wizard route:
   - OBS scan
   - profile questionnaire
   - generated preset write
4. Add overlay generator schema + storage in `presets/overlays`.
5. Add "Apply Overlay to Scene" action using OBS source creation/update calls.
6. Add unified "Change Summary" log entry after every macro/assistant run.

---

## Non-Negotiables

- no unsafe direct execution from AI without confirmation for destructive actions
- all assistant operations must pass safety manager and permission policy
- generated files must remain editable by users
- no lock-in: user can export/import scene and overlay profiles

---

## V2 Success Metrics

- time-to-first-live: under 10 minutes for new users
- setup completion rate: >80%
- assistant task success rate: >90% for common tasks
- support questions about setup: down by 50%+
- perceived value supports $20 one-time purchase without confusion
