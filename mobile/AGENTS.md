# Mobile Guidelines

- Treat `mobile/` as a Flutter/Dart subproject. Use its `pubspec.yaml`, committed lockfile, and documented Flutter commands rather than root npm workflows.
- Read `../STYLESEED.md` before mobile UI changes. Preserve its locked product identity within Flutter conventions unless the user explicitly approves a change.
- Preserve compatibility with the public brief API, strict payload decoding, SQLite offline text cache, online audio, and accessible loading/error/empty states. For API, payload, audio, or push contract changes, also use `$maintain-watchtower-worker`.
- Keep the iOS `dev` and `prod` schemes distinct: `io.damao.watchtower.dev` / `WatchTower Dev` uses sandbox APNs, while `io.damao.watchtower` / `WatchTower` uses production APNs for TestFlight and App Store builds.
- Do not add Android FCM unless explicitly requested. Android v1 intentionally shares reading, caching, and background audio without push integration.
- Never commit or log APNs keys, device tokens, encryption material, signing credentials, or secret-bearing build configuration.
- Run `flutter analyze` and `flutter test` for mobile changes. Run the relevant dev/prod flavor build when platform, native, signing, or release configuration changes, and report checks that require Apple accounts or physical devices.
- Treat signing, archive upload, TestFlight, store publication, and production APNs operations as external mutations requiring explicit authorization.
