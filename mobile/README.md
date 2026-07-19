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

The `dev` flavor is fixed to `https://dev.watchtower.damao.io`; `prod` and the flavorless Android build are fixed to `https://watchtower.damao.io`. Unknown flavors fail at startup. Use an explicit override only for a localhost, loopback, or private-network proxy during focused debugging; public and cross-environment overrides fail closed:

```sh
flutter run --flavor dev --dart-define=WATCHTOWER_API_BASE_URL=http://127.0.0.1:8787
```

For the repository's short-lived physical-device Auth proxy, use the Mac's explicit private IP instead of loopback. Only `Debug-dev` includes the local-network usage description and `NSAllowsLocalNetworking`; production builds contain neither exception. The Settings screen displays the effective API base URL and strict `/api/meta` environment, Worker tag/version, and deployment time so device acceptance can prove the exact backend candidate.

The single iOS `Runner` target exposes two shared schemes:

- `dev`: `io.damao.watchtower.dev`, `WatchTower Dev`, and sandbox APNs for local development.
- `prod`: `io.damao.watchtower`, `WatchTower`, and production APNs for TestFlight and App Store archives.

Create a production archive with `flutter build ipa --flavor prod --release`. A local `Debug-prod` build still receives a sandbox entitlement and the push API intentionally rejects that app/environment combination. Android intentionally omits push notification integration in v1 while sharing reading, SQLite caching, and background audio.

## Auth0 callbacks

The app fetches the public Auth0 issuer, audience, and flavor-specific client ID from `/api/auth/config`. `auth0_flutter` 2.4.0 stores and refreshes credentials through the platform Credentials Manager; authentication initializes after `runApp` and must never block reading, offline cache, audio, or push.

Register both HTTPS and custom-scheme callback/logout URLs for each iOS Native client:

```text
https://auth.watchtower.damao.io/ios/io.damao.watchtower.dev/callback
io.damao.watchtower.dev://auth.watchtower.damao.io/ios/io.damao.watchtower.dev/callback
https://auth.watchtower.damao.io/ios/io.damao.watchtower/callback
io.damao.watchtower://auth.watchtower.damao.io/ios/io.damao.watchtower/callback
```

iOS uses `webcredentials:auth.watchtower.damao.io` for Universal Links and automatically falls back to the bundle-ID scheme on iOS 16 and 17.0–17.3. Android uses the production Native client and the HTTPS callback `https://auth.watchtower.damao.io/android/io.damao.watchtower/callback`; Auth0 App Links verification must include the current debug signing fingerprint, then the release fingerprint when a production Android key exists.
