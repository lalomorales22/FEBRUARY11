# Contributing to FEBRUARY11

Thanks for contributing.

## Development Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create local environment:
   ```bash
   cp .env.example .env
   ```
3. Start development server:
   ```bash
   npm run dev
   ```

## Project Structure

- `backend/src`: API, orchestration, OBS integration
- `frontend`: operator dashboard
- `shared/src`: shared TypeScript contracts
- `presets`: default presets and policies
- `tests`: node test runner suites
- `docs`: setup/feature/authoring/troubleshooting guides

## Quality Bar

Before opening a PR:

```bash
npm run check
npm test
```

If you add behavior, add or update tests in `tests/`.
If you add features, update the relevant file in `docs/`.

## Pull Request Guidelines

- Keep changes scoped and focused.
- Include a short problem statement and solution summary.
- Note any OBS-side setup required to validate.
- Include screenshots or clips for dashboard UI changes.

## Preset Contributions

When contributing presets:

- Place files in `presets/chaos`.
- Use unique `id` values.
- Include clear `name`, `description`, and tags.
- Avoid destructive actions by default.
- Document assumptions (scene/input names) in PR description.

## Reporting Security Issues

Do not open public issues for sensitive vulnerabilities.
Open a private security advisory in your Git hosting platform or contact maintainers directly.

