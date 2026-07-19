# Release Evidence and Resumption

## Use live evidence, not remembered state

At every resume point, re-check:

```sh
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main
git worktree list
```

Then inspect current exact-SHA CI, Dev `/api/meta`, production `/api/meta` when applicable, and the Git-private Dev receipt. Repository history, an old chat message, or an earlier version ID may have drifted.

## Dev validation receipt

The repository stores the local operational receipt under the common Git directory shared by every worktree:

```text
<git-common-dir>/watchtower-release/dev-validation.json
```

Resolve `<git-common-dir>` with `git rev-parse --git-common-dir`; do not hardcode a checkout-specific `.git` path. The directory is untracked, private to the local Git repository, mode `0700`, and contains no credentials. This shared location lets the feature worktree write Dev evidence and the main checkout consume the exact same receipt without copying or committing it. Its release-relevant fields are:

- schema and `pending-manual` or `passed` status;
- candidate full SHA;
- Dev Worker version ID and tag;
- run Worker tag, run ID, stage, date, and outcome;
- ordered run-start, run-finish, automated, and manual timestamps;
- public brief status, non-zero item count, generation timestamp, and missing-source names;
- active sandbox subscription count;
- audio/cover/push states, current-run generation timestamps, and stable error codes;
- APNs-accepted delivery count;
- explicit waiver component/reason, if any;
- manual acceptance timestamp.

Do not add access tokens, Auth0 user IDs, device tokens, token ciphertext, token HMACs, installation identifiers, account IDs, D1/R2 IDs, secret presence, local network details, or signing data.

Production and TestFlight require all of these:

```text
receipt.status == passed
receipt.gitSha == HEAD
receipt.workerVersionTag == git-HEAD
receipt.runWorkerVersionTag == git-HEAD
receipt.workerVersionId == current Dev /api/meta.workerVersionId
receipt.stage in {final, recovery}
receipt.manualAcceptanceAt is present
Dev /api/meta.workerVersionTag == git-HEAD
```

A pending receipt means automated checks passed but physical/manual acceptance did not. A mismatched receipt is stale and must not be edited by hand to fit a new SHA.

## TestFlight build receipt

The signed build command stores artifact provenance beside the Dev receipt:

```text
<git-common-dir>/watchtower-release/testflight-build.json
```

The Git-private receipt contains the schema version, candidate full SHA, fresh IPA filename/mtime/SHA-256, exact archive name and app version/build, archive Info/executable mtimes, Mach-O UUID evidence tying the export to the archive, pinned Flutter version, Xcode version, and build timestamp. It contains no signing credential, provisioning profile, entitlement dump, absolute path, archive bytes, or IPA bytes. `npm run testflight:inspect` must verify the current IPA and `mobile/build/ios/archive/Runner.xcarchive` against this receipt before inspecting metadata or signing. Rebuilding, replacing, renaming, or modifying either artifact invalidates that evidence; rerun the signed build instead of editing the receipt.

## Evidence levels

Use exact language:

| Evidence | What it proves | What it does not prove |
| --- | --- | --- |
| Local tests | deterministic behavior in the tested environment | CI, remote bindings, signing, device behavior |
| Wrangler dry run | both configs compile with declared bindings | secrets exist remotely or deployment works |
| Exact-SHA CI | repository gates passed for that commit | Dev/production provider behavior |
| `/api/meta` | environment and deployed Worker version | pipeline or downstream acceptance |
| Dev run succeeded | protected trigger completed for the recorded Worker tag | media, APNs, or physical display by itself |
| D1 delivery `delivered` | APNs accepted the send | the phone displayed or opened it |
| Pending Dev receipt | automated pipeline/downstream checks completed | manual app checklist |
| Passed Dev receipt | operator accepted the printed Dev checklist | production deployment or TestFlight |
| Production smoke | deployed SHA and selected public surfaces are healthy | TestFlight signing/install/APNs |
| IPA inspection | archive metadata/signing/entitlements match | Apple validation or upload |
| Organizer validation | Apple validation passed | upload completed |
| `Uploaded to Apple` | upload receipt exists | processing, group assignment, or install |
| Physical TestFlight smoke | installed build and production behavior passed | App Store review or publication |

## Record manual checkpoints explicitly

For the pre-candidate App Store Connect lookup, record the UTC observation time, app name, bundle ID `io.damao.watchtower`, iOS marketing-version train, latest uploaded build number, and displayed processing/status label. Treat this as manual live evidence; repository and `pubspec.yaml` values do not replace it.

Keep these additional checkpoints independent: physical Dev notification display/open, Dev protected-feature acceptance, Organizer validation, `Uploaded to Apple` receipt, Apple processing completion, internal-group assignment, TestFlight install, application smoke, real production-publication APNs display/open, tag creation, and tag push. Never mark one from evidence belonging to another.

## Waivers

Allow only a narrowly scoped audio waiver through the repository command. Require:

- explicit user approval;
- exact candidate SHA;
- non-empty reason;
- observed audio state and stable error code;
- visible output in Dev acceptance and production preflight.

Do not edit the receipt manually, convert a timeout into a pass, or broaden an audio waiver to cover the pipeline, cover, push, device receipt, Auth, exploration, environment identity, production smoke, signing, or TestFlight.

## Resume from the first incomplete checkpoint

Use this order:

1. worktree routing, scope classification, implementation, and focused tests;
2. when TestFlight is required, manual App Store Connect latest-build lookup and build-number bump;
3. final root and applicable mobile verification on the resulting candidate bytes;
4. candidate commit;
5. feature push and exact-SHA branch CI;
6. Dev deployment;
7. Dev automated run;
8. Dev manual acceptance;
9. fast-forward `main`;
10. main push and exact-SHA main CI;
11. production release and smoke;
12. stop for a server-only, mobile-wire-compatible change; otherwise TestFlight build-receipt creation and IPA inspection;
13. Organizer validate/upload receipt;
14. processing/group/install/real-production-publication APNs;
15. annotated tag and tag push.

Do not repeat a completed remote mutation merely to recreate missing notes. Verify current state read-only and continue when evidence is still valid. If the SHA or environment changed, invalidate the dependent evidence and repeat only the affected downstream stages.

Release, migration, Dev E2E, and TestFlight commands serialize through environment lock files in the same common Git directory. Production release/migration/TestFlight take Dev then production locks in a fixed order so shared Dev acceptance cannot change mid-flight. Emergency production rollback deliberately takes only the production lock and does not wait on Dev. If a command reports an existing lock, inspect the lock's PID/timestamp and live process state. Remove only that exact lock after proving the owning process no longer exists; never clear locks merely because a command appears slow.

## Handoff template

Report concise conclusions for each applicable field:

```text
Scope:
Branch / SHA:
Working tree:
Local verify:
Mobile verify:
Feature CI:
Dev deployment tag / version:
Dev run ID / stage / date / outcome:
Audio / cover / push / APNs accepted:
Physical sandbox receipt:
Dev protected-feature checklist:
Waivers:
Main synchronization / CI:
Production version / smoke / rollback:
TestFlight version / build / IPA inspection:
ASC lookup UTC / app / bundle / version train / latest build / status:
TestFlight build receipt Git SHA / IPA artifact SHA-256:
Organizer validation / upload receipt:
Internal install / production APNs:
Tag:
Skipped or blocked checks:
Remaining authorized action:
```

Never compress “not run,” “pending,” “blocked,” “waived,” and “passed” into one generic success state.
