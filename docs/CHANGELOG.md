# Changelog

All notable changes to this project are documented in this file.

## [0.1.0] - 2026-02-12

### Added

- Phase 1 foundation:
  - OBS connection manager with reconnect/backoff
  - health/status API and WebSocket snapshot broadcasting
  - safety manager with kill switch and action rate limiting
  - dark-themed operator dashboard shell
- Phase 2 orchestration:
  - Chaos Engine preset loader/executor with serial/parallel timeline support
  - Auto Director with audio meter rules, hold windows, hysteresis, and cooldowns
  - fallback-scene safety trigger endpoint
- Phase 3 production tooling:
  - Replay Director capture workflow with optional auto-play and lower-third overlays
  - Plugin Bridge for guarded `CallVendorRequest` execution
  - keyboard shortcuts, quick actions, confirmation prompts, and toast alerts
- Phase 4 hardening and OSS assets:
  - Node test suite for safety, chaos, auto-director, plugin bridge, and config parsing
  - load/stability scripts for event bursts and reconnect storms
  - docs set (`docs/SETUP.md`, `docs/FEATURES.md`, `docs/PRESET_AUTHORING.md`, `docs/TROUBLESHOOTING.md`)
  - community templates and contribution guide
  - MIT license
  - OBS-Overlays bridge integration (status, test actions, overlay links, dashboard controls)
  - overlay URL auto-detect + copy helper
  - OBS-Overlays fallback through FEBRUARY11 scene APIs when direct OBS scene list is unavailable
