# Shared Dev Deployment and Full E2E

## Preconditions

Require all of the following before mutating shared Dev:

- clean feature worktree;
- committed candidate and full SHA;
- successful branch `CI` for that exact SHA;
- current `wrangler.jsonc` still maps Dev to `dev.watchtower.damao.io`, the Dev Worker, Dev D1/R2/queues, `crons=[]`, sandbox APNs, and `DEPLOYMENT_ENV=dev`;
- an allowlisted Dev test user;
- explicit authority for Dev migration/deployment;
- explicit authority for the later `final` or `recovery` trigger because it incurs real provider cost and sends sandbox push.

Shared Dev carries only one candidate. The release command reports the currently deployed tag. Confirm replacement deliberately when another SHA is present.

## Deploy the candidate

Run:

```sh
npm run release:dev
```

The command must print the Dev environment, domain, database, Worker, branch, and full SHA, require an exact confirmation, apply Dev migrations, deploy with `--strict`, tag the Worker as `git-<sha>`, and smoke `/api/meta`, public APIs, Auth config, Access-protected pages, and static assets. Before any mutation, it must require public `/api/meta.workerVersionId` to equal the unique 100% Wrangler deployment version. If deploy or smoke fails, it automatically rolls the Worker back to the captured Dev version and repeats version-aware public smoke; D1 migrations remain forward-only.

Do not replace this command with direct Wrangler migration or deploy calls. A failed smoke does not authorize changing production.

## Run WatchTower Dev on a physical iPhone

For ordinary device checks that do not need CLI access-token capture:

```sh
cd mobile
flutter run --flavor dev -d <device-id>
```

Verify that the app identifies the Dev API SHA, uses bundle ID `io.damao.watchtower.dev`, selects the Dev Auth0 Native client, and registers sandbox APNs. Do not use the prod flavor for sandbox verification.

## Capture a short-lived Dev token safely

Use the repository proxy only when the CLI needs the same allowlisted session as the physical app. The proxy forwards only to `https://dev.watchtower.damao.io`, never prints the token, and stores the first bearer value in a private gitignored file while it is running.

1. Use a trusted private network. Determine the Mac's active private IP, for example with `ipconfig getifaddr en0`. Do not bind to `0.0.0.0` or a public address.
2. Start the proxy from the repository root:

   ```sh
   npm run dev:auth-proxy -- --host <private-ip> --allow-insecure-lan
   ```

   For a simulator or same-host client, omit `--host` and use the default loopback binding.

3. Copy the printed non-secret `apiBaseUrl` and absolute `tokenFile` path. Keep the proxy terminal open.
4. Start the physical Dev app through that local proxy:

   ```sh
   cd mobile
   flutter run --flavor dev -d <device-id> \
     --dart-define=WATCHTOWER_API_BASE_URL=http://<private-ip>:<port>
   ```

5. Sign in with the allowlisted test user. Exercise an authenticated API so the proxy can capture the bearer token. Enable daily notifications and wait for the app to finish subscription registration.
6. Never paste the token into chat, a shell argument, a committed file, or a log. Never inspect iOS Keychain contents.

The private-LAN proxy uses cleartext HTTP and is therefore a conditional diagnostic risk, not a confidential transport. `--allow-insecure-lan` is an explicit acknowledgement. Use it only on a trusted isolated network, keep the random port private, bind one interface, start the phone immediately so the proxy can pin the first client address, keep the session short, and stop the proxy immediately after the E2E command has read the token file. It captures only a successful `/api/auth/me` bearer. Graceful proxy shutdown deletes the captured file; if the process was killed forcefully, remove the stale gitignored file before the next run. Prefer a trusted local TLS or USB-tunneled path if one is available.

## Trigger and audit the pipeline

Choose a UTC target date whose requested stage has not already succeeded. For `final` and `recovery`, the date must be today or earlier in UTC; a future publication date cannot produce current public/media evidence and the CLI rejects it before confirmation or provider cost. `collect` and `draft` may use a future date when that is the focused test. The D1 contract is idempotent by `(stage, target_date)` and intentionally exposes no reset or force operation.

From the repository root, provide the token by file:

```sh
WATCHTOWER_DEV_ACCESS_TOKEN_FILE=<absolute-token-file> \
  npm run e2e:dev -- final YYYY-MM-DD
```

The command performs these gates before and after the protected trigger:

- clean worktree, exact-SHA CI, and current Dev `/api/meta` match;
- at least one active `io.damao.watchtower.dev + sandbox` subscription before `final` or `recovery`;
- exact confirmation `dev-e2e <stage> <date> <sha>` before the remote mutation;
- bounded pipeline polling;
- returned run Worker tag equals `git-HEAD`;
- successful `published` pipeline outcome for `final` or `recovery`;
- a cache-busted public `GET /api/briefs/<date>` with a published status and at least one item;
- bounded audio, cover, push-batch, and delivery polling;
- cover and, unless waived, audio are reachable through public `HEAD` requests;
- at least one APNs-accepted delivery;
- a pending Git-private receipt in the worktree-shared common directory containing only safe release evidence.

The script outputs run ID, states, counts, and stable error codes only. It does not output token values, device tokens, encrypted token material, HMACs, or full user IDs.

After the automated E2E command has consumed the token file, stop the proxy and the proxy-bound app, then relaunch a plain `flutter run --flavor dev -d <device-id>` without the URL override. Confirm the settings metadata now shows the direct Dev hostname and the same candidate tag/version before completing the manual checklist. The authenticated session should remain in the platform credential store; if it does not, sign in again through the direct Dev endpoint. Do not perform final device acceptance against a stopped local proxy.

If an approved external audio incident must not block unrelated validation, use:

```sh
WATCHTOWER_DEV_ACCESS_TOKEN_FILE=<absolute-token-file> \
  npm run e2e:dev -- final YYYY-MM-DD --waive-audio "<explicit reason>"
```

This requires the additional exact confirmation `waive dev audio <sha>` and records the observed audio status/error. Do not use an audio waiver to hide a regression caused by the candidate. Cover, push, environment identity, protected Auth, and production smoke have no silent waiver path.

## Complete manual acceptance

An APNs-accepted delivery is not device proof. Wait for the user to confirm that the sandbox notification appeared on the physical iPhone. Also verify on `WatchTower Dev`:

- metadata points to the candidate Dev SHA;
- latest brief and archive load;
- offline text cache still reads;
- login succeeds with the Dev Auth0 client;
- feedback read/write works for the allowlisted user;
- exploration returns Chinese content and sources;
- account deletion fails before mutation with HTTP `403` and `ACCOUNT_DELETION_DISABLED`;
- sandbox notification opens the expected brief;
- audio works unless an explicit recorded waiver applies.

Then promote the pending receipt:

```sh
npm run e2e:dev:accept -- <run-id>
```

Read the printed checklist and waiver list. Type `accept dev <run-id>` only after the real checks pass. The receipt becomes `status=passed`; production and TestFlight reject any pending or stale receipt.

The acceptance prompt requires an interactive terminal. Do not automate its stdin or replace physical-device confirmation with an environment variable.

## Interpret common failures

- `DEV_SANDBOX_SUBSCRIPTION_REQUIRED`: keep the Dev app running, allow notifications, wait for registration, then retry before triggering.
- `DEV_PIPELINE_WORKER_SHA_MISMATCH`: the date/stage belongs to another Worker tag or shared Dev changed; use the correct candidate and a fresh date.
- `DEV_PIPELINE_OUTCOME_NOT_PUBLISHED`: the run was idempotent, empty, collection-only, unchanged, or otherwise did not publish this run; choose a fresh date that can exercise the candidate.
- `DEV_PIPELINE_TIMEOUT`: inspect the run ID and queue logs read-only; do not submit duplicate force operations.
- `DEV_DOWNSTREAM_AUDIT_TIMEOUT`: inspect only safe D1 statuses/error codes and queue logs. Preserve partial evidence.
- APNs accepted but no device display: keep the receipt pending and diagnose device settings, app identity, subscription freshness, foreground/background state, and notification payload.
- stale token file: stop the old proxy, remove only the exact gitignored file, and re-authenticate. Never reuse a token from an unrelated run.
