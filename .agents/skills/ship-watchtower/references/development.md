# Development and Candidate Formation

## Orient before editing

1. Read the root `AGENTS.md` and any nested `public/AGENTS.md` or `mobile/AGENTS.md` that applies.
2. Inspect `README.md`, `package.json`, `mise.toml`, `wrangler.jsonc`, the affected implementation, focused tests, and migrations.
3. Run `git status --short --branch`, `git worktree list`, and inspect the current full SHA.
4. Preserve unrelated changes in the primary checkout. Do not switch its branch by default.

## Route existing work before creating a worktree

Choose the route from live Git state:

- If an existing feature worktree already owns the intended branch or scoped changes, reuse it.
- If the primary checkout is clean and no existing feature worktree owns the work, create a new isolated feature worktree.
- If the primary checkout has unrelated changes, leave them untouched and create the feature worktree from `origin/main`.
- If the primary checkout already contains the intended uncommitted changes, do not create a competing implementation silently. Continue there only when it is already the intended feature branch and that ownership is explicit. Otherwise, agree on transferring only the reviewed scoped changes into a new feature worktree, keep the originals intact until the transfer is verified, and exclude ignored credentials, build products, and unrelated files.

Never auto-stash, reset, clean, discard, or overwrite an existing diff to manufacture a clean starting point. Do not switch the primary checkout's branch while it is dirty. If ownership of existing changes is ambiguous, stop before changing files and resolve that ownership first.

## Create an isolated feature worktree when needed

Use the latest remote `main` as the base and a lower-case `<type>/<short-description>` branch unless the repository already names the branch:

```sh
git fetch origin main
git worktree add -b feat/example .worktrees/example origin/main
```

Resolve the exact `.worktrees/<name>` path before creating or removing it. Never delete another active worktree. Treat fetch, branch creation, and worktree creation as separate from commit or push authority.

## Decide the release surface early

Assign all applicable tags; the rows below are release requirements, not mutually exclusive categories. Apply the union of the required checks. An infrastructure change may also be a mobile-contract change, and an incident fix may also touch worker-web or mobile-contract surfaces.

Use this matrix before choosing tests or a build number:

| Change | Root verify | Mobile verify | Dev full E2E | Production | TestFlight |
| --- | --- | --- | --- | --- | --- |
| Worker internal, wire-compatible | required | when integration risk warrants | required | required | no |
| Web-only assets | required | no | required | required | no |
| `mobile/` | required | required | required | required | required |
| Mobile-consumed API contract | required | required | required | required | required |
| Auth, audio, push, exploration | required | required | required | required | required when mobile behavior or wire contract changes |
| Wrangler, D1, queues, environment isolation | required | when mobile integration is affected | required | required | only when mobile behavior or contract changes |

If TestFlight will be required, manually query App Store Connect immediately after scope classification and while the feature worktree is still clean. Record the UTC query timestamp, app name, production bundle ID `io.damao.watchtower`, iOS marketing-version train, latest uploaded build number, and its processing/status label. Do not record Apple session data, credentials, or tokens. Choose a strictly larger number and run:

```sh
npm run testflight:bump -- --build-number <N>
```

Include that change in the candidate commit. A later build-number change creates a new SHA and invalidates prior Dev acceptance.

`testflight:bump` intentionally rejects a dirty worktree. If implementation already made the tree dirty, do not bypass the gate. Either preserve the existing work and form a clean candidate worktree with the bump first before transferring the reviewed changes, or, only when the user separately authorizes an intermediate implementation commit, commit the reviewed implementation, run the bump from that clean state, and include a second reviewed bump commit before final verification, CI, Dev validation, and promotion.

## Implement with focused evidence

For non-trivial automatable production logic:

1. Add a focused failing test.
2. Run it and observe the expected failure.
3. Implement the smallest coherent fix.
4. Re-run the focused test.
5. Refactor only after the behavior passes.

For UI, configuration, signing, packaging, and integration changes, state the observable acceptance evidence first. Keep code symbols, comments, technical docs, and commits in English; keep user-facing copy in Chinese.

Do not edit an applied migration. Add a new numbered migration and keep it compatible with the currently deployed Worker. Separate destructive schema changes into expand, deploy, and later contract releases.

## Run local gates

Run the complete root gate from the feature worktree:

```sh
npm run verify
```

This covers type-generation consistency, lint, typecheck, Worker/Web tests, script behavior tests, production and Dev Wrangler dry-run builds, and secret scan.

Run the mobile gate when the matrix requires it:

```sh
npm run verify:mobile
```

This runs Flutter dependency resolution, analyze, tests, unsigned Dev debug and Prod release iOS builds, and post-build checks for the exact bundle ID, APNs entitlement, and Dev-only local-network plist contract. It does not prove Apple signing, sandbox APNs delivery, production APNs delivery, or TestFlight installation.

## Review before committing

Review only the scoped diff:

```sh
git diff --check
git diff --stat
git diff
git status --short
```

Check correctness, avoidable complexity, unrelated churn, migration compatibility, public asset exclusions, test gaps, generated artifacts, and secret exposure. Confirm that no token file, `.env`, APNs key, signing material, D1 identifier dump, provisioning profile, or IPA entered the diff.

## Commit, push, and wait for CI

Commit only after explicit commit authority. Use an imperative English Conventional Commit. Push the feature branch only after explicit push authority; deployment or TestFlight authority does not imply Git push authority.

After the push, require the `CI` workflow for the exact full SHA to succeed. A CI run for an earlier commit, a different branch head, or only one job is insufficient. The release scripts re-check the exact SHA, but inspect failures before attempting Dev deployment.

## Promote without changing the accepted SHA

After Dev acceptance:

1. Re-review the scoped diff and migration compatibility.
2. Ensure `main` has not advanced. If it has, rebase or reconstruct the candidate, then repeat CI, Dev deployment, and affected E2E because the SHA changed.
3. Fast-forward local `main` only:

```sh
git merge --ff-only <feature-branch>
```

4. Push `main` only with explicit push authority.
5. Require `main` CI for the same accepted SHA before production.

Do not squash, amend, cherry-pick, or create a merge commit after Dev acceptance; each changes the SHA and invalidates the receipt.
