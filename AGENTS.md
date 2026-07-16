# Repository Guidelines

## Purpose and language

WatchTower is a Chinese daily technology and product intelligence brief. It runs as a strict TypeScript Cloudflare Worker with D1, scheduled ingestion, and a framework-free static frontend.

- Write user-facing copy and product documentation in Chinese.
- Write code, symbols, comments, technical documentation, and commit messages in English.
- Keep changes small, explicit, and consistent with the live implementation. Do not describe unsupported behavior as planned functionality.

## Toolchain

- Use the Node.js LTS selected by `mise.toml`.
- Use npm and the committed `package-lock.json`; prefer `npm ci` for a clean install.
- Prefer existing npm scripts over ad hoc tool invocations.
- Use Wrangler through project-local npm scripts. Check current Cloudflare documentation and the local Wrangler schema before relying on an API or configuration field that may have changed.
- Never print, log, hardcode, or commit secrets. Keep `.env.example` value-free and use environment variables or Wrangler secrets for credentials.

## Architecture

- `src/index.ts`: Worker `fetch` and `scheduled` entrypoints.
- `src/http/router.ts`: static asset dispatch, public brief API, authenticated feedback API, caching, and validation.
- `src/ingestion/`: Tavily search/extraction, retry behavior, URL normalization, candidate selection, and the scheduled pipeline.
- `src/domain/`: shared types, cron resolution, DeepSeek integration, and untrusted model-output validation.
- `src/storage/repository.ts`: all D1 persistence and public payload hydration.
- `migrations/`: append-only D1 schema history.
- `public/`: accessible static HTML, CSS, JavaScript, icons, and security headers.
- `test/`: Vitest tests using the Cloudflare Workers pool and isolated D1 migrations.
- `wrangler.jsonc`: source of truth for bindings, assets, required secrets, cron triggers, observability, and production routing.
- `STYLESEED.md`: binding design contract for every WatchTower UI.

## Implementation invariants

- Keep source support aligned across `SOURCE_KINDS`, URL normalization, Tavily queries, D1 constraints, UI labels, Wrangler behavior, and tests. The current sources are Hacker News, Product Hunt, GitHub, and Kickstarter.
- Keep the four cron expressions aligned between `wrangler.jsonc` and `src/domain/schedule.ts`: `collect`, `draft`, `final`, and `recovery`.
- Scheduled stages must remain idempotent. A successful stage is skipped on repeat execution.
- Require at least three successful sources before publishing. Publish `complete` only with all four sources; otherwise publish `partial` and retain the missing-source list.
- Preserve an existing valid brief when a later model call fails. Do not call the model again when refreshed evidence is unchanged.
- Treat every external response and model response as untrusted. Preserve retries, timeouts, URL normalization, candidate/entity ID checks, field-length checks, source quotas, continuity checks, and the single model-repair attempt.
- Do not allow generated model output to introduce URLs. Public source links must come from normalized candidate evidence.
- Apply feedback before source quotas: exclude `irrelevant`, deprioritize `uninteresting`, and prioritize material updates for `follow`.
- Use D1 bindings and repository functions for persistence. Do not call Cloudflare's REST API from inside the Worker or introduce request-scoped mutable module state.
- Every Promise must be awaited, returned, deliberately voided, or handed to the appropriate Worker lifecycle mechanism. Preserve explicit error handling and structured scheduled-run logs.

## API, data, and security

- Public brief endpoints are read-only `GET`/`HEAD` APIs. Preserve CORS, ETag handling, public cache headers, strict UTC date validation, stable error envelopes, and the `1..100` list limit.
- Feedback endpoints require the configured Bearer token, use `Cache-Control: no-store`, and intentionally omit public CORS. Preserve timing-safe token comparison.
- Feedback may target only a valid entity present in the claimed, already published brief. Keep the supported values `follow`, `irrelevant`, and `uninteresting` synchronized across types, storage, router, frontend, and tests.
- Do not expose unpublished briefs. Repository reads must continue to enforce `publish_at <= now`.
- Never edit an applied migration to change schema behavior. Add a new numbered migration and update D1 tests, generated environment types, and affected code together.
- Treat `npm run db:migrate:remote`, `npm run deploy`, and Cloudflare configuration changes as remote production mutations. Run them only with explicit user authorization and verify the intended account, database, route, and hostname first.

## UI changes

- Read `STYLESEED.md` before touching `public/` UI files. Do not change locked values without explicit user approval.
- Preserve the single Radar Cyan accent, system font stack, Soft radius rules, Snap motion, neutral supporting palette, responsive editorial hierarchy, and one dominant focal point.
- Keep all payload content immediately available; do not animate headlines or brief items into view. Respect `prefers-reduced-motion`.
- Preserve accessible semantics, keyboard operation, focus visibility, touch targets, loading/error/empty states, and light/dark contrast.
- For a material UI change, use the repository StyleSeed workflow, run `ss-score` against the real UI, fix findings, and reach at least `80/100` before presenting or shipping it. When the UI can be rendered, use visual verification as the final UI gate.

## Development workflow

1. Inspect the relevant implementation, tests, `package.json`, `wrangler.jsonc`, and migrations before changing behavior.
2. For automatable non-trivial production logic, add or update a failing test first, implement the minimum change, then refactor without changing behavior.
3. Keep interfaces and types explicit. Use generated `Env` bindings from `worker-configuration.d.ts`; regenerate them with `npm run cf-typegen` after binding changes.
4. Update tests whenever API behavior, validation, pipeline outcomes, selection, schedules, persistence, or migrations change.
5. Review the scoped diff for correctness, avoidable complexity, unrelated churn, missing verification, and secret exposure before committing.
6. Do not commit, push, create a pull request, migrate remote data, or deploy unless the user explicitly asks for that action.

## Verification

Run the complete local gate before declaring implementation work done:

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

Also run focused tests while iterating. For documentation-only changes, verify commands, routes, environment variables, and operational claims against the current source, then run `git diff --check`; the complete gate is still preferred before handoff. State any absent, blocked, skipped, or environment-dependent check explicitly.
