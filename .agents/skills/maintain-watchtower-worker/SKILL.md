---
name: maintain-watchtower-worker
description: Maintain WatchTower's Cloudflare Worker contracts across ingestion, sources, schedules, DeepSeek validation, D1 persistence, public and feedback APIs, migrations, audio and push pipelines, Wrangler configuration, and related tests. Use for any runtime, API, data, storage, infrastructure, or production-behavior change under src/, migrations/, test/, scripts/, public/, mobile/, or wrangler.jsonc.
---

# Maintain WatchTower Worker

## Orient before editing

Inspect the affected code and its consumers before changing behavior:

- `src/index.ts` owns Worker `fetch`, `scheduled`, and queue entrypoints.
- `src/http/router.ts` owns static asset dispatch, public brief APIs, authenticated feedback APIs, caching, and validation.
- `src/ingestion/` owns Tavily search/extraction, retries, URL normalization, candidate selection, and the scheduled pipeline.
- `src/domain/` owns shared types, cron resolution, DeepSeek integration, and untrusted model-output validation.
- `src/storage/repository.ts` owns D1 persistence and public payload hydration.
- `src/audio/` and `src/push/` integrate R2, queues, narration, APNs, and mobile-facing state.
- `wrangler.jsonc` is authoritative for bindings, assets, required secrets, triggers, observability, queues, rate limits, and production routing.
- `migrations/` is append-only D1 schema history; `test/` uses the Workers pool and isolated migrations.
- `public/`, `mobile/`, and `STYLESEED.md` define the web/mobile consumers and binding design contract.

## Preserve ingestion and publication contracts

- Keep Hacker News, Product Hunt, GitHub, and Kickstarter aligned across `SOURCE_KINDS`, URL normalization, Tavily queries, D1 constraints, UI labels, Wrangler behavior, and tests.
- Keep `collect`, `draft`, `final`, and `recovery` cron expressions aligned between `wrangler.jsonc` and `src/domain/schedule.ts`.
- Keep scheduled stages idempotent and skip an already successful stage.
- Publish only after at least three sources succeed. Use `complete` only for all four sources; otherwise use `partial` and retain missing sources.
- Preserve an existing valid brief when a later model call fails. Do not call the model again when refreshed evidence is unchanged.
- Treat every external and model response as untrusted. Preserve retries, timeouts, URL normalization, candidate/entity ID validation, field limits, source quotas, continuity checks, and exactly one model-repair attempt.
- Never accept model-created URLs. Hydrate public links only from normalized candidate evidence.
- Apply feedback before source quotas: exclude `irrelevant`, deprioritize `uninteresting`, and prioritize material updates for `follow`.

## Preserve runtime, data, and API contracts

- Use D1 bindings and repository functions for persistence. Do not call Cloudflare's REST API from the Worker or introduce request-scoped mutable module state.
- Await, return, deliberately void, or hand every Promise to the appropriate Worker lifecycle mechanism. Keep explicit error handling and structured scheduled-run logs.
- Keep public brief endpoints read-only `GET`/`HEAD` APIs with CORS, ETags, public cache headers, strict UTC date validation, stable error envelopes, and the `1..100` list limit.
- Never expose unpublished briefs; enforce `publish_at <= now` in repository reads.
- Require the configured Bearer token for feedback endpoints, compare it timing-safely, return `Cache-Control: no-store`, and intentionally omit public CORS.
- Accept feedback only for a valid entity in the claimed published brief. Keep `follow`, `irrelevant`, and `uninteresting` synchronized across types, storage, router, frontend, migrations, and tests.
- Keep audio artifacts in R2 and asynchronous audio/push work on the configured queues. Preserve queue retry behavior, APNs environment/topic matching, registration security, and public payload compatibility.

## Change schema and configuration safely

- Never edit an applied migration. Add a numbered migration and update D1 tests, generated `Env` types in `worker-configuration.d.ts`, and affected code together.
- Prefer bindings over REST and regenerate types with `npm run cf-typegen` after binding changes.
- Treat `npm run db:migrate:remote`, `npm run deploy`, and Cloudflare configuration changes as production mutations. Follow root authorization rules and verify the target account, database, route, and hostname.

## Verify the contract

Add or update focused tests first for non-trivial production behavior. Cover affected API semantics, validation failures, idempotence, publication thresholds, unchanged-evidence behavior, feedback ordering, storage visibility, migrations, queue retries, audio, or push behavior. Then run the root repository verification gate and review the scoped diff for contract drift and secret exposure.
