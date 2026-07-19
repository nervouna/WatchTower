# Main Promotion, Production Release, and Rollback

## Promote the accepted SHA

Require a `passed` Dev receipt for the candidate and preserve its SHA exactly. Follow the fast-forward procedure in `development.md`; push `main` only with explicit authority and wait for `main` CI on the same SHA.

Before production, require:

- clean `main` checkout;
- local `main == origin/main`;
- exact full SHA equals the Dev receipt SHA;
- current Dev `/api/meta` still reports `git-<sha>`;
- `main` CI success for that SHA;
- explicit authority for production migration and deployment.

If Dev has already moved to a different candidate, redeploy and reaccept the release SHA. Do not rely on a stale receipt alone.

## Deploy production

Run only:

```sh
npm run release:prod
```

The command prints the production environment, hostname, database, Worker, branch, SHA, Dev run evidence, and any waiver. It requires the exact confirmation `production <sha>` before mutation. That confirmation authorizes this invocation's migration, deployment, smoke, and automatic Worker rollback to the captured prior version if this invocation's deployment or smoke fails. It does not authorize an unrelated, later, or manually initiated rollback; use the emergency rollback flow below with separate explicit authority.

The release sequence is:

1. fetch and verify `origin/main`;
2. verify exact-SHA CI, Dev metadata, and passed Dev receipt;
3. require public production `/api/meta.workerVersionId` to equal the unique Worker version receiving 100% traffic through Wrangler, then save it privately as the rollback target;
4. list pending migrations even when production already carries `git-<sha>`; apply only the reviewed additive production D1 migrations;
5. re-check the complete Git/CI/Dev receipt/environment baseline immediately before deployment;
6. deploy the Worker with `--strict`, `git-<sha>` tag, and a production message;
7. re-check clean Git bytes, wait for production `/api/meta` propagation, and require public metadata to match Wrangler traffic;
8. validate the latest/list/Auth JSON shapes, home, archive, and cache-busted assets;
9. hash-compare production `app.js` and `styles.css` against the candidate bytes.

If deployment, post-deploy Git continuity, or smoke fails after deployment starts, the script rolls Worker traffic back to the saved version without waiting for another Wrangler prompt, waits for 100% traffic, and verifies public metadata plus rollback-safe API/page smoke. It does not and cannot roll back D1, R2, queue messages, external provider calls, or APNs deliveries. Preserve the failure and rollback evidence.

## Apply migration discipline

- List and review unapplied migrations before authorizing release.
- Keep every migration compatible with the old Worker until the new Worker is healthy.
- Never drop or rename a column, tighten a constraint, or rewrite durable data in the same release that first stops using the old shape.
- Use expand, deploy, verify, and a later contract release.
- Never edit or fake the applied-migration ledger.
- Do not attempt a destructive D1 rollback after Worker rollback.

## Verify production independently

After the command succeeds, record:

- production `/api/meta.environment=production`;
- `workerVersionTag=git-<sha>` and Worker version ID;
- latest/list/Auth API smoke;
- page and archive smoke;
- asset hash results;
- whether a rollback occurred;
- migration conclusion.

Use a cache-busting query when independently rechecking web/API bytes. Do not expose account IDs, resource IDs, secret state, or local paths through public metadata.

## Perform an emergency Worker rollback

Diagnose read-only first and identify a known-good Worker version ID. When production safety requires rollback and the user explicitly authorizes it, use a clean checkout or clean incident worktree:

```sh
npm run rollback:prod -- <version-id>
```

The rollback command deliberately does not require current Dev metadata, Dev receipt, GitHub CI, or synchronized `main`; those checks can block incident recovery after shared Dev has moved. It still:

- validates the version ID shape;
- prints the exact production target and current local SHA;
- uses Wrangler's unique 100% traffic version as incident preflight truth; if public metadata is readable it must agree, while an unavailable broken `/api/meta` emits a stable warning instead of blocking recovery;
- requires `rollback production <version-id>`;
- rolls back only the production Worker deployment with a message;
- waits for 100% traffic and verifies public `/api/meta`, latest/list/Auth APIs, home, and archive against the target version.

After the command's automated smoke, independently verify affected functionality against the expected known-good version. Separately assess whether forward-compatible migrations or queued side effects need remediation. Never describe Worker rollback as a full environment rollback.

## Decide whether to continue to TestFlight

Stop the release flow after successful production smoke when the change is purely server-side and preserves every mobile-consumed wire contract. Record TestFlight as not applicable; do not build, inspect, upload, assign, install, or increment a build number.

Continue through `testflight.md` when:

- any committed file under `mobile/` changed; or
- briefs, Auth, audio, push, exploration, metadata, or another mobile-consumed request/response contract changed; or
- the user explicitly requests a TestFlight build.

Do not increase the build number for a compatible internal Worker change merely because production deployed.
