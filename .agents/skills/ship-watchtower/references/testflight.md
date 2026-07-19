# TestFlight Delivery

## Preserve one release SHA

TestFlight must come from the same clean, synchronized `main` SHA that:

- passed exact-SHA CI;
- has a passed Dev E2E receipt;
- is still visible from Dev `/api/meta`;
- is deployed and smoke-tested in production;
- is visible from production `/api/meta`.

If the build number was not included before Dev validation, stop. Query App Store Connect for the latest uploaded build, choose a larger number, run the bump command, commit and push with separate authority, then repeat CI, Dev release/E2E, fast-forward promotion, and production release for the new SHA.

## Choose and bump the build number before the candidate commit

Treat App Store Connect as the source of truth, not only `mobile/pubspec.yaml`. This is a manual pre-candidate checkpoint: record the UTC query timestamp, app name, production bundle ID `io.damao.watchtower`, iOS marketing-version train, latest uploaded build number, and its displayed processing/status label. Do not record browser session data, credentials, access tokens, or signing material.

Then run:

```sh
npm run testflight:bump -- --build-number <N>
```

The command changes only `mobile/pubspec.yaml` and requires `N` to exceed the repository value. It does not commit, push, build, sign, upload, create a TestFlight group, or create an App Store version.

Never overwrite or reuse an uploaded build number. A rejected or bad build is superseded by a higher number.

Complete this lookup and bump before the candidate commit, branch CI, Dev deployment, and Dev E2E. After production smoke, continue only with build, receipt verification, inspection, Organizer upload, processing, and physical acceptance; do not change the build number in place.

## Build the signed production IPA

Require explicit signing/build authority and a locally available Apple signing identity/profile. Run from the repository root:

```sh
npm run testflight:build
```

The command rechecks the production baseline, passed Dev receipt, Dev metadata, production metadata, CI, clean `main`, and `main == origin/main`, then builds:

```text
flutter build ipa --flavor prod --release
```

Do not build a TestFlight IPA from the Dev flavor, a feature branch, a dirty checkout, or a SHA not yet deployed in production.

The command requires the exact Flutter version pinned in `.flutter-version`, which is also consumed by CI. It records the build start and rejects stale outputs. On success, it prints both exact artifacts and writes `<git-common-dir>/watchtower-release/testflight-build.json`:

```text
mobile/build/ios/ipa/watchtower.ipa
mobile/build/ios/archive/Runner.xcarchive
```

This Git-private receipt binds the full Git SHA, fresh IPA filename/mtime/SHA-256, exact archive name and app version/build, archive Info/executable mtimes, Mach-O UUID evidence, Flutter version, Xcode version, and build timestamp. It must contain no IPA bytes, profile, entitlement dump, signing credential, or absolute local path.

## Inspect before upload

Run:

```sh
npm run testflight:inspect
```

Pass an explicit IPA path after `--` only when the default `mobile/build/ios/ipa/watchtower.ipa` is not the intended artifact.

Before decoding the IPA, the command requires its name, mtime, SHA-256, version/build, pinned Flutter toolchain, current archive evidence, and exported Mach-O UUIDs to match the shared build receipt for the current Git SHA. Any IPA or archive whose identity, bytes, executable UUID evidence, or release metadata differs from the recorded artifacts fails closed. Require every inspection check to pass:

- bundle ID `io.damao.watchtower`;
- expected marketing version and strictly increased build number;
- Apple Distribution signing;
- `aps-environment=production`;
- `get-task-allow=false`;
- exactly one top-level `.app`, a non-expired distribution profile, and exact Team/application identifiers;
- signed entitlements and embedded profile agree on Team ID, application identifier, and production APNs;
- `beta-reports-active=true`;
- `ITSAppUsesNonExemptEncryption=false`.

The inspector decodes entitlements and the embedded profile in a private temporary directory and deletes it on both success and failure. Do not commit or retain the IPA, archive, profile, signing identity output, or decoded entitlements as repository evidence.

## Validate and upload in Xcode Organizer

Treat these as separate checkpoints:

1. Open exactly `mobile/build/ios/archive/Runner.xcarchive`, the archive printed by `testflight:build` and bound to the inspected IPA receipt, in Xcode Organizer. Do not select an older Organizer archive with the same marketing version.
2. Run `Validate App` and record the independent validation conclusion.
3. Review warnings. Do not dismiss a signing, entitlement, bundle, version, privacy, or export-compliance error as harmless.
4. Obtain explicit upload authority.
5. Choose App Store Connect distribution and upload.
6. Count upload as successful only when Organizer shows an `Uploaded to Apple` receipt for the expected version/build.

An IPA build or local inspection is not an upload. A progress dialog or successful validation is not an upload receipt. Do not create an App Store version or enter submission/review flows.

## Complete internal TestFlight acceptance

After Apple processing completes:

1. Add the build to the intended internal testing group.
2. Install that exact build from TestFlight on a physical iPhone.
3. Verify production `/api/meta` and the expected Git SHA.
4. Verify latest brief, archive, offline text cache, login, feedback, audio, and exploration.
5. Verify the production bundle registers `io.damao.watchtower + production` APNs.
6. Wait for and observe a real scheduled production publication push, then require the notification to appear and open the expected brief.

Do not add or call a production pipeline trigger, invoke the Dev-only endpoint against production, enable an ad hoc cron, call a queue or scheduled handler manually, or force/backfill production data merely to manufacture APNs evidence. If no real publication occurs during the acceptance window, keep production APNs and the overall TestFlight acceptance pending and hand off that exact checkpoint.

Record App Store processing, group assignment, install, application smoke, APNs acceptance, and physical receipt separately. Sandbox push success does not prove production APNs.

## Tag only after real-device success

After the TestFlight smoke passes, create the annotated tag with explicit tag authority:

```sh
git tag -a 'testflight/v<version>+<build>' -m 'TestFlight v<version>+<build>'
```

Push that exact tag only with separate explicit push authority:

```sh
git push origin 'testflight/v<version>+<build>'
```

If the build is bad, remove it from the testing group when appropriate, fix the issue, choose a higher build number, and repeat the release path. Never move or reuse the old tag and never reuse the build number.

## Stop condition

The workflow ends when the internal TestFlight build is processed, installed, and smoke-tested on a physical device, production APNs is proven, and the optional release tag is explicitly pushed. Do not submit for App Review or publish to the App Store.
