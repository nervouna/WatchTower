# Repository Guidelines

## Purpose and language

WatchTower is a Chinese daily technology/product intelligence brief with a strict TypeScript Cloudflare Worker, framework-free web frontend, and Flutter client.

- Write user-facing copy and product documentation in Chinese.
- Use English for code, symbols, comments, technical docs, and commits.
- Keep changes small and consistent with live behavior; never describe unsupported functionality as planned.

## Toolchain and guidance

- Use the Node.js LTS from `mise.toml`, npm, and `package-lock.json`; prefer `npm ci` and existing scripts.
- Use `README.md` for current architecture, commands, APIs, and deployment facts. `wrangler.jsonc` is authoritative for Worker bindings and production configuration.
- Use project-local Wrangler scripts. Verify changing Cloudflare APIs or configuration against current official documentation and the local schema.
- Never print, log, hardcode, or commit secrets. Keep `.env.example` value-free and use environment variables or Wrangler secrets.
- Use `$maintain-watchtower-worker` for Worker runtime, ingestion, schedule, API/data, D1, migration, audio, push, or Wrangler changes.
- Follow `public/AGENTS.md` for web UI work and `mobile/AGENTS.md` for Flutter work.

## Safety and workflow

- Use a dedicated worktree under `.worktrees/` when work needs a branch; do not switch the primary working tree by default.
- Inspect affected implementation, tests, metadata, configuration, and migrations. For automatable non-trivial production logic, start with a failing test, implement the minimum change, then refactor.
- Count a source as successful only when it yields usable normalized candidates, and never persist or publish a generated brief with zero items.
- Preserve anonymous access to briefs, archives, audio, offline cache, and push. Auth initialization and Auth0 or JWKS failures must never block readable public content.
- Derive protected capabilities only from a verified Auth0 access token and the D1 allowlist. Never reintroduce a shared fixed token, browser-entered credentials, or a client-selected account deletion target.
- Keep interfaces and types explicit, use generated `Env` bindings, and update affected tests.
- Treat `public/` as deployable bytes. Keep repository-only metadata, including `public/AGENTS.md`, excluded through `public/.assetsignore`, and verify the exclusion against production after asset changes.
- Never edit an applied migration. Treat remote migrations, deploys, and Cloudflare configuration as production mutations requiring explicit authorization and verification of the account, database, route, and hostname.
- Review the scoped diff before committing for correctness, avoidable complexity, unrelated churn, verification gaps, and secret exposure.
- Do not commit, push, open a pull request, migrate remote data, or deploy unless explicitly requested.

## Verification

Before declaring implementation work complete, run:

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

Run focused tests while iterating. For documentation-only changes, verify commands, routes, variables, and operational claims against current sources and run `git diff --check`; the full gate remains preferred. Report skipped, blocked, absent, or environment-dependent checks.
