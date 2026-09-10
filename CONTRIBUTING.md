# Contributing to Kinfolk

## Before you start

- Use Node.js 22 or newer and pnpm 11.
- Read [README.md](README.md) for the architecture and [CLAUDE.md](CLAUDE.md) for project invariants.
- Open an issue before a large architectural change.
- Never use real family records in fixtures, screenshots, logs, or pull requests.

## Local setup

```bash
pnpm install
```

Copy `.env.example` to `.env.local` for local use. Never commit `.env.local`, credentials, tokens, database dumps, local database files, or MCP configuration. Follow [docs/SETUP.md](docs/SETUP.md) for OAuth and database setup.

Run the Next.js app with:

```bash
pnpm dev --port 3007
```

## Changes

Keep changes focused and match the existing style. Use conventional commit subjects such as `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, or `chore:`.

Drizzle migrations in `drizzle/*.sql` and their metadata are versioned schema history. Commit generated migrations when a schema change requires them; never commit database contents or ad hoc SQL exports.

## Verification

Run the complete local gate before opening a pull request:

```bash
pnpm lint
pnpm test
pnpm typecheck
pnpm --dir frontend typecheck
pnpm build
pnpm --dir frontend build
pnpm audit --audit-level=low
pnpm audit --prod --audit-level=low
git diff --check
```

`pnpm test` runs the isolated Vitest regression suite with synthetic records and an
in-memory PGlite database using the committed migrations. Its configuration disables
environment-file loading and supplies no production database or OAuth credentials.
Do not claim behavior is verified by compilation alone; report the canvas, authentication,
or database checks actually performed and state which checks remain unrun.

## Pull requests

Explain what changed, why, and how it was verified. Keep one related change set in one pull request. Update user-facing documentation, package versions, and [CHANGELOG.md](CHANGELOG.md) when behavior changes.

Security reports must follow [SECURITY.md](SECURITY.md), not the public issue tracker.
