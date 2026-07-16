# WatchTower Mobile

Flutter client for the WatchTower Chinese technology and product intelligence brief.

## Development

Run from this directory:

```sh
flutter pub get
flutter analyze
flutter test
flutter run --flavor dev
```

Override the production API only for local development:

```sh
flutter run --flavor dev --dart-define=WATCHTOWER_API_BASE_URL=http://127.0.0.1:8787
```

The single iOS `Runner` target exposes two shared schemes:

- `dev`: `io.damao.watchtower.dev`, `WatchTower Dev`, and sandbox APNs for local development.
- `prod`: `io.damao.watchtower`, `WatchTower`, and production APNs for TestFlight and App Store archives.

Create a production archive with `flutter build ipa --flavor prod --release`. A local `Debug-prod` build still receives a sandbox entitlement and the push API intentionally rejects that app/environment combination. Android intentionally omits push notification integration in v1 while sharing reading, SQLite caching, and background audio.
