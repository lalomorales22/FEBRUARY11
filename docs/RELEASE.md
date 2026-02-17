# Release Playbook

Use this flow for each public release.

## 1. Validate Quality Gates

```bash
npm run check
npm test
npm run test:coverage
```

Run staging stress checks:

```bash
npm run load:event-burst
npm run load:reconnect-storm
```

## 2. Finalize Release Notes

- Update `CHANGELOG.md`.
- Confirm version in `package.json`.
- Verify docs updates for new features or env vars.

## 3. Tag Release

```bash
git tag v0.1.0
git push origin v0.1.0
```

For subsequent releases, bump tag/version accordingly.

## 4. Create GitHub Release

- Create release from the pushed tag.
- Paste changelog entry as release notes.
- Attach screenshots/clips for UI-facing changes.

## 5. Post-Release Verification

- Fresh-install smoke test using `README.md`.
- Check API health endpoint.
- Confirm dashboard can connect and run one safe preset.

