# Mobile Guidelines

- Treat `mobile/` as a Flutter/Dart subproject. Use its `pubspec.yaml`, committed lockfile, and documented Flutter commands rather than root npm workflows.
- Read `../STYLESEED.md` before mobile UI changes. Preserve its locked product identity within Flutter conventions unless the user explicitly approves a change.
- Preserve compatibility with the public brief API, strict payload decoding, SQLite offline text cache, online audio, and accessible loading/error/empty states. For API, payload, authentication, audio, or push contract changes, also use `$maintain-watchtower-worker`.
- Keep startup text-first: call `runApp` before optional auth, audio, and push initialization. Auth, cache, audio, or push failures must degrade independently and never block network refresh, offline reading, or readable brief content.
- Keep the iOS `dev` and `prod` schemes distinct: `io.damao.watchtower.dev` / `WatchTower Dev` uses sandbox APNs, while `io.damao.watchtower` / `WatchTower` uses production APNs for TestFlight and App Store builds.
- Do not add Android FCM unless explicitly requested. Android v1 intentionally shares reading, caching, and background audio without push integration.
- Use Auth0 Credentials Manager for credential persistence and refresh. Never persist access or refresh tokens separately, and never log tokens, authorization codes, full callback URLs, or other authentication credentials.
- Select the Auth0 Native client that matches the flavor; Android currently uses the Mobile Prod client.
- Never commit or log APNs keys, device tokens, encryption material, signing credentials, or secret-bearing build configuration.
- Run `flutter analyze` and `flutter test` for mobile changes. Run the relevant dev/prod flavor build when platform, native, signing, or release configuration changes, and report checks that require Apple accounts or physical devices.
- Before TestFlight upload, increment the build number beyond the latest uploaded build and inspect the exported `prod` IPA for bundle ID, version/build, export compliance, production APNs, distribution signing, `get-task-allow=false`, and `beta-reports-active=true`. Validate before distribution, then require both an Organizer `Uploaded to Apple` receipt and a real TestFlight install smoke.
- Treat signing, archive upload, TestFlight, store publication, and production APNs operations as external mutations requiring explicit authorization.
