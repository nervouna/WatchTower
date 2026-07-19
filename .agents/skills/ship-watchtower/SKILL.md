---
name: ship-watchtower
description: Run WatchTower's repository-specific lifecycle from a feature worktree through local verification, branch CI, shared Dev deployment and full E2E acceptance, fast-forward promotion, production deployment or rollback, and conditional TestFlight delivery. Use when implementing or shipping WatchTower changes, validating Dev pipelines or sandbox APNs on a physical iPhone, preparing a production release, handling a Worker rollback, building or inspecting a signed IPA, uploading to TestFlight, or deciding which release checkpoints a change requires.
---

# Ship WatchTower

## Purpose

Carry WatchTower changes through one traceable state machine without crossing environment, Git, credential, signing, or publication boundaries implicitly. Treat repository scripts as the only automation entry points and collect evidence at each checkpoint.

## Load scoped guidance

Read only the references needed for the requested stage:

- Read [development.md](references/development.md) for worktrees, implementation, local verification, commits, pushes, CI, and change classification.
- Read [dev-validation.md](references/dev-validation.md) before any shared Dev migration, deployment, pipeline run, token capture, sandbox push, or Dev acceptance.
- Read [production.md](references/production.md) before fast-forward promotion, production migration/deployment/smoke, rollback, or incident recovery.
- Read [testflight.md](references/testflight.md) before build-number changes, signed IPA work, Organizer validation/upload, internal testing, production APNs verification, or TestFlight tags.
- Read [evidence.md](references/evidence.md) when resuming work, auditing release readiness, recording a waiver, or handing off an incomplete run.

Also load the repository skills required by the affected surface:

- Use `$maintain-watchtower-worker` for Worker runtime, API, D1, migrations, queues, ingestion, audio, cover, push, exploration, Wrangler configuration, web assets, or mobile contract changes.
- Use `$node-npm-workflow` for Node/npm execution and toolchain diagnosis.
- Use `$wrangler` before direct Wrangler inspection or when repository scripts do not expose a required read-only diagnostic.
- Use `$mcp-secrets-and-local-config` for any credential, secret, `.env`, token-file, or local wrapper work.

## Enforce invariant boundaries

- Keep Dev and production Worker, D1, R2, queues, hostname, secrets, mobile app identity, and APNs environment distinct.
- Bind every deployed Worker to the full Git SHA through `git-<sha>` metadata and verify `/api/meta` after deployment.
- Never treat a matching Dev metadata tag as Dev E2E acceptance. Require the shared private receipt under Git's common directory with `status=passed` for the same SHA.
- Never treat APNs `delivered` in D1 as proof that a device displayed a notification. Require explicit physical-device acceptance.
- Never print or persist access tokens outside a private, gitignored token file. Never inspect iOS Keychain contents or add a UI that exposes tokens.
- Never edit an applied migration. Use additive, backward-compatible migrations; use expand, deploy, then contract for destructive schema evolution.
- Never infer authorization for commit, push, remote migration, deploy, rollback, signing, upload, group assignment, tag creation, or tag push from a different action.
- Run remote-mutation and manual-acceptance confirmations in an interactive terminal. Repository commands reject non-interactive confirmation; do not bypass a human checkpoint with an environment variable or scripted stdin.
- Treat the exact Dev replacement confirmation and exact `production <sha>` confirmation as authority for that invocation's migration, deployment, smoke, and its own automatic Worker rollback if deployment or smoke fails. Require separate authority for any later or manually initiated rollback.
- Stop at TestFlight. Do not create an App Store version, submit for review, or publish to the App Store.

## Select the required path

Assign every applicable change tag before implementing. Tags are combinable, not mutually exclusive; for example, a queue migration that changes the mobile push contract is both `infrastructure` and `mobile-contract`.

1. `worker-web`: Worker internals or web assets with no mobile-consumed wire-contract change.
2. `mobile-contract`: anything under `mobile/`, or a briefs/auth/audio/push/exploration contract consumed by mobile.
3. `infrastructure`: Wrangler bindings, secrets declarations, queues, D1 migrations, routes, environment isolation, or deployment scripts.
4. `incident`: production regression requiring diagnosis or rollback before normal promotion.

Run the common path for every shipped change:

```text
feature worktree
  -> classify scope
  -> while the worktree is still clean, query ASC latest uploaded build + testflight:bump when TestFlight is required
  -> focused tests and implementation
  -> npm run verify on the resulting candidate bytes
  -> npm run verify:mobile on the resulting candidate when mobile-contract or relevant integration changes
  -> focused diff review
  -> explicit commit and explicit feature-branch push
  -> branch CI success
  -> explicit shared Dev release
  -> Dev automated E2E + physical-device acceptance receipt
  -> fast-forward main without changing the validated SHA
  -> explicit main push + main CI success
  -> explicit production release + SHA smoke
  -> finish for compatible worker-web changes
  -> build/inspect/upload/TestFlight acceptance for mobile-contract changes
```

Use the incident path only when production safety requires it. Diagnose read-only first. A Worker rollback does not roll back D1, R2, queues, external API effects, or APNs deliveries.

## Operate from live repository truth

Before each stage:

1. Read the applicable `AGENTS.md`, current `README.md`, `package.json`, `wrangler.jsonc`, and affected implementation/tests.
2. Inspect `git status --short --branch`, branch, full `HEAD`, worktrees, and scoped diff.
3. Route work through an existing feature worktree when it already owns the branch or scoped changes. If the primary checkout is dirty, preserve it exactly; never auto-stash, reset, clean, switch its branch, or overwrite its files. Follow [development.md](references/development.md) before creating or transferring work.
4. Re-read command help when local CLI behavior matters. Do not reconstruct a remembered command if a repository npm script exists.
5. Preserve unrelated changes and other worktrees. Stage only the approved slice.
6. State the next remote mutation and wait for the required authority if it has not already been granted explicitly.

## Keep human checkpoints human

Do not infer or synthesize acceptance for checkpoints that require a person or physical device:

- the sandbox notification must appear on a physical iPhone and open the expected Dev brief;
- an audio waiver requires explicit approval and a recorded reason;
- production mutation requires the exact command confirmation;
- Xcode Organizer validation and the `Uploaded to Apple` receipt require direct observation;
- the processed build must be assigned, installed from TestFlight, and exercised on a physical iPhone;
- production APNs must be observed from a real production publication;
- annotated tag creation and tag push require their own explicit authorities.

Leave the stage pending when a human checkpoint has not happened. Do not translate APNs provider acceptance, CLI output, or an assumed operator action into physical acceptance.

## Use repository automation

Prefer these entry points over ad hoc commands:

```sh
npm run verify
npm run verify:mobile
npm run db:migrate:dev
npm run db:migrate:prod
npm run release:dev
npm run dev:auth-proxy -- [--host <private-ip> --allow-insecure-lan]
npm run e2e:dev -- final YYYY-MM-DD
npm run e2e:dev:accept -- <run-id>
npm run release:prod
npm run rollback:dev -- <version-id>
npm run rollback:prod -- <version-id>
npm run testflight:bump -- --build-number <N>
npm run testflight:build
npm run testflight:inspect -- [ipa-path]
```

Use `npm run dev:auth-proxy` only for short-lived Dev authentication capture during a real-device E2E run. Follow [dev-validation.md](references/dev-validation.md) exactly; keep the proxy bound to loopback or one explicit private IP and stop it after the E2E command has read the token file.

The legacy `deploy`, `deploy:dev`, and `db:migrate:remote` commands intentionally fail closed. Do not bypass them with direct Wrangler mutation.

## Treat receipts and waivers as evidence

- A Dev run writes a Git-private pending receipt in the shared common directory only after the current Worker tag, pipeline result, media state, push batch, and APNs acceptance pass automated checks.
- `npm run e2e:dev:accept -- <run-id>` promotes that receipt to `passed` only after the operator confirms the printed real-device and protected-feature checklist.
- Production and TestFlight gates reject a missing, pending, stale, wrong-SHA, wrong-stage, or wrong-Worker receipt.
- A TestFlight build writes a second Git-private receipt in the shared common directory that binds the full Git SHA, fresh IPA bytes, the exact `Runner.xcarchive`, Mach-O UUID evidence, marketing version/build, pinned Flutter version, Xcode version, and build time. Inspection must reject an IPA or archive that does not match that receipt.
- Audio may be waived only with explicit user approval and a non-empty reason through `--waive-audio <reason>`. Preserve the observed status and stable error code in the receipt. Never silently waive cover, push, authentication, environment identity, or production smoke.
- A pipeline `idempotent-skip` or recovery `complete-noop` is useful regression evidence but cannot validate affected pipeline code. Use a target date that has not already succeeded for that stage; do not add reset, delete, or force APIs.

## Finish with an evidence-backed handoff

Report:

- branch and full SHA;
- exact scoped files or commit;
- local verification and CI conclusions;
- Dev Worker tag, run ID, stage/date, downstream states, device acceptance, and any waiver;
- production Worker version and smoke conclusion when deployed;
- IPA version/build, inspection, Organizer validation/upload receipt, internal install, and production APNs conclusion when TestFlight applies;
- every skipped, blocked, manual, or environment-dependent checkpoint;
- remaining Git, Cloudflare, Apple, Auth0, APNs, or TestFlight mutations that still require explicit authorization.

Do not claim a stage that only has partial evidence. Resume from the first incomplete checkpoint instead of repeating completed remote mutations.
