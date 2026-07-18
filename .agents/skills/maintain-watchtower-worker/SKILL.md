---
name: maintain-watchtower-worker
description: Maintain WatchTower's Cloudflare Worker contracts across ingestion, sources, schedules, DeepSeek validation, D1 persistence, Auth0 and allowlisted APIs, migrations, audio and push pipelines, Wrangler configuration, and related tests. Use for any runtime, API, data, storage, infrastructure, or production-behavior change under src/, migrations/, test/, scripts/, public/, mobile/, or wrangler.jsonc.
---

# Maintain WatchTower Worker

## Orient before editing

Inspect the affected code and its consumers before changing behavior:

- `src/index.ts` owns Worker `fetch`, `scheduled`, and queue entrypoints.
- `src/http/router.ts` owns static asset dispatch, public brief APIs, authenticated feedback APIs, caching, and validation.
- `src/ingestion/` owns Tavily search/extraction, retries, URL normalization, candidate selection, and the scheduled pipeline.
- `src/domain/` owns shared types, cron resolution, DeepSeek integration, and untrusted model-output validation.
- `src/auth/` owns Auth0 access-token validation and the boundary between invalid credentials and unavailable authentication infrastructure.
- `src/storage/repository.ts` owns D1 persistence and public payload hydration.
- `src/audio/` and `src/push/` integrate R2, queues, narration, APNs, and mobile-facing state.
- `wrangler.jsonc` is authoritative for bindings, assets, required secrets, triggers, observability, queues, rate limits, and production routing.
- `migrations/` is append-only D1 schema history; `test/` uses the Workers pool and isolated migrations.
- `public/`, `mobile/`, and `STYLESEED.md` define the web/mobile consumers and binding design contract.

## Preserve ingestion and publication contracts

- Keep Hacker News, Product Hunt, GitHub, and Kickstarter aligned across `SOURCE_KINDS`, URL normalization, Tavily queries, D1 constraints, UI labels, Wrangler behavior, and tests.
- Keep `collect`, `draft`, `final`, and `recovery` cron expressions aligned between `wrangler.jsonc` and `src/domain/schedule.ts`.
- Keep scheduled stages idempotent and skip an already successful stage.
- Gate publication on usable content, not source count. For `draft`, `final`, and `recovery`, generate when the target date has at least one stored normalized candidate, including evidence saved by an earlier stage. Never call the model with zero candidates or persist a generated brief with zero items.
- Use `complete` only when all four sources succeeded; otherwise use `partial` and retain missing sources. Source success describes completeness and observability, not publication eligibility.
- Preserve an existing valid brief when a later model call fails. Do not call the model again when refreshed evidence is unchanged.
- Treat every external and model response as untrusted. Preserve retries, timeouts, URL normalization, candidate/entity ID validation, field limits, source quotas, continuity checks, and exactly one model-repair attempt.
- Never accept model-created URLs. Hydrate public links only from normalized candidate evidence.
- Apply feedback before source quotas: exclude `irrelevant`, deprioritize `uninteresting`, and prioritize material updates for `follow`.
- Keep exploration Search queries within the provider limit using Unicode-safe truncation. Continue on partial Search success, but preserve stable Search or Extract stage errors when research did not produce usable evidence.
- Keep the exploration prompt contract synchronized with every validator field, key, length, array, citation, source-ID, and URL rule. A valid single-domain result is `partial`; only complete fixed sections citing at least two domains are `complete`.
- Preserve non-empty exploration evidence across synthesis retries and terminal model failures so a later trigger can skip Tavily. Never persist an empty evidence array, and accumulate actual Tavily credits and DeepSeek tokens across attempts.

## Preserve runtime, data, and API contracts

- Use D1 bindings and repository functions for persistence. Do not call Cloudflare's REST API from the Worker or introduce request-scoped mutable module state.
- Await, return, deliberately void, or hand every Promise to the appropriate Worker lifecycle mechanism. Keep explicit error handling and structured scheduled-run logs.
- Keep public brief endpoints read-only `GET`/`HEAD` APIs with CORS, ETags, public cache headers, strict UTC date validation, stable error envelopes, and the `1..100` list limit.
- Never expose unpublished briefs; enforce `publish_at <= now` in repository reads.
- Preserve anonymous reading even when authentication initialization, Auth0, or JWKS is unavailable.
- Authenticate protected endpoints with an Auth0 RS256 access token. Strictly validate signature, issuer, audience, authorized party, expiration, issued-at time, and a non-empty subject, then derive feedback and audio-retry capabilities from the D1 allowlist.
- Return `401` for missing or invalid credentials, `403` for an authenticated user without the required capability, and retryable `503` for unavailable Auth0 or JWKS infrastructure. Return `Cache-Control: no-store` and intentionally omit public CORS on every protected response.
- Derive account deletion targets only from the verified token subject. Never accept a client-selected user ID or reintroduce a shared fixed credential.
- Accept feedback only for a valid entity in the claimed published brief. Keep `follow`, `irrelevant`, and `uninteresting` synchronized across types, storage, router, frontend, migrations, and tests.
- Keep audio artifacts in R2 and asynchronous audio/push work on the configured queues. Preserve queue retry behavior, APNs environment/topic matching, registration security, and public payload compatibility. For 1-4 item briefs, narrate every ranked item and apply the matching short-audio duration profile; keep the 5-7 item selection behavior for larger briefs.
- Honor `BRIEF_PUSH_ENABLED` before any push persistence or queue send so controlled recovery runs can regenerate content without sending a late notification.

## Change schema and configuration safely

- Never edit an applied migration. Add a numbered migration and update D1 tests, generated `Env` types in `worker-configuration.d.ts`, and affected code together.
- Prefer bindings over REST and regenerate types with `npm run cf-typegen` after binding changes.
- Treat `npm run db:migrate:remote`, `npm run deploy`, and Cloudflare configuration changes as production mutations. Follow root authorization rules and verify the target account, database, route, and hostname.

## Verify the contract

Add or update focused tests first for non-trivial production behavior. Cover affected API semantics, authentication and authorization failures, idempotence, publication thresholds, unchanged-evidence behavior, feedback ordering and audit identity, account deletion, storage visibility, migrations, queue retries, audio, or push behavior. Then run the root repository verification gate and review the scoped diff for contract drift and secret exposure.
