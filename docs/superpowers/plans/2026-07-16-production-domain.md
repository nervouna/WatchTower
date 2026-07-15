# Production Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve WatchTower only at `https://watchtower.damao.io` and disable its public `workers.dev` hostname.

**Architecture:** Keep `wrangler.jsonc` as the Worker deployment source of truth. Attach `watchtower.damao.io` as a Cloudflare Worker Custom Domain so Cloudflare manages DNS and TLS, and set `workers_dev` to `false` without changing application code, bindings, schedules, secrets, or data.

**Tech Stack:** Cloudflare Workers, Wrangler 4.111.0, Worker Static Assets, D1, npm

## Global Constraints

- The only public production hostname is `https://watchtower.damao.io`.
- Keep existing static assets, HTTP API routes, D1, scheduled triggers, observability, and secrets unchanged.
- Do not print, log, or commit secret values from `.env`.
- Use the existing `npm` scripts and project-local Wrangler installation.

---

### Task 1: Configure and deploy the production Custom Domain

**Files:**
- Modify: `wrangler.jsonc`
- Verify: `package.json`
- Verify: `src/http/router.ts`

**Interfaces:**
- Consumes: the deployed `watchtower-daily-brief` Worker, the active `damao.io` Cloudflare zone, and the existing `.env` deployment secrets file.
- Produces: the HTTPS origin `https://watchtower.damao.io`; no TypeScript interface or binding changes.

- [ ] **Step 1: Confirm deployment prerequisites without exposing secrets**

Run:

```bash
test -f .env
WRANGLER_LOG_PATH=/tmp/watchtower-wrangler.log ./node_modules/.bin/wrangler whoami
git status --short
```

Expected: `.env` exists; Wrangler reports the `Damao Labs` account with Workers and route write permissions; the worktree contains no unrelated changes that overlap `wrangler.jsonc`.

- [ ] **Step 2: Add the Custom Domain and disable `workers.dev`**

Change the existing `workers_dev` property and insert `routes` immediately after it in `wrangler.jsonc`:

```jsonc
"workers_dev": false,
"routes": [
  {
    "pattern": "watchtower.damao.io",
    "custom_domain": true
  }
],
```

Do not alter any other configuration field.

- [ ] **Step 3: Validate the configuration and complete local verification**

Run:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Expected: ESLint and TypeScript exit successfully; all Vitest tests pass; Wrangler's dry run lists the existing D1 and Assets bindings and exits successfully without uploading.

- [ ] **Step 4: Review the scoped diff before deployment**

Run:

```bash
git diff --check
git diff -- wrangler.jsonc
git status --short
```

Expected: the configuration diff contains only `workers_dev: false` and the `watchtower.damao.io` Custom Domain route; no secrets or unrelated changes appear.

- [ ] **Step 5: Deploy using the existing secret-loading workflow**

Run:

```bash
npm run deploy
```

Expected: Wrangler uploads a new `watchtower-daily-brief` version, reports `watchtower.damao.io` as a Custom Domain, and does not report a `workers.dev` route. If Wrangler reports an existing CNAME conflict, stop without deleting DNS records and inspect the conflicting record before retrying.

- [ ] **Step 6: Verify DNS, TLS, the application, and API routing**

Run:

```bash
curl --fail --silent --show-error --retry 6 --retry-delay 5 --retry-all-errors \
  --output /tmp/watchtower-index.html \
  --write-out 'status=%{http_code} remote_ip=%{remote_ip} ssl_verify=%{ssl_verify_result}\n' \
  https://watchtower.damao.io/
rg -n '<title>|WatchTower' /tmp/watchtower-index.html
curl --fail --silent --show-error --retry 6 --retry-delay 5 --retry-all-errors \
  --output /tmp/watchtower-api.json \
  --write-out 'status=%{http_code} content_type=%{content_type}\n' \
  'https://watchtower.damao.io/api/briefs?limit=1'
```

Expected: the homepage returns HTTP 200 with `ssl_verify=0` and contains the WatchTower page identity; `GET /api/briefs?limit=1` returns HTTP 200 with an `application/json` content type, including when no brief is currently available.

- [ ] **Step 7: Confirm the deployed routing state**

Run:

```bash
WRANGLER_LOG_PATH=/tmp/watchtower-wrangler.log ./node_modules/.bin/wrangler deployments list
```

Expected: the newest deployment version and timestamp match Step 5. Confirm the deployment output from Step 5 contains only the Custom Domain route; Wrangler has no read-only command that proves the disabled `workers.dev` hostname independently of the deployed configuration.

- [ ] **Step 8: Conduct the focused pre-commit review and commit the configuration**

Review `git diff -- wrangler.jsonc` for correctness, avoidable complexity, unrelated churn, verification gaps, and secret exposure. Then run:

```bash
git add wrangler.jsonc
git commit -m "chore: configure production domain"
```

Expected: one commit containing only the intended production routing configuration.
