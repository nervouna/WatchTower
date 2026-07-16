# WatchTower Mobile

Flutter client for the WatchTower Chinese technology and product intelligence brief.

## Development

Run from this directory:

```sh
flutter pub get
flutter analyze
flutter test
flutter run
```

Override the production API only for local development:

```sh
flutter run --dart-define=WATCHTOWER_API_BASE_URL=http://127.0.0.1:8787
```

The iOS target owns the native APNs bridge. Android intentionally omits push notification integration in v1 while sharing reading, SQLite caching, and background audio.
