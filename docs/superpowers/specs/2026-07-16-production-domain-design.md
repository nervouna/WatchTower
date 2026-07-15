# Production Domain Design

## Goal

Serve the existing WatchTower Worker at `https://watchtower.damao.io` as its only public production hostname.

## Current State

- `watchtower-daily-brief` is deployed as a Cloudflare Worker with static assets, HTTP API routes, D1, scheduled triggers, and observability.
- The Worker is currently reachable through its `workers.dev` hostname.
- `wrangler.jsonc` is the source of truth for deployment configuration.

## Design

Declare `watchtower.damao.io` as a Worker Custom Domain in `wrangler.jsonc`:

```jsonc
"routes": [
  {
    "pattern": "watchtower.damao.io",
    "custom_domain": true
  }
]
```

Set `workers_dev` to `false` so the Cloudflare-managed `workers.dev` hostname is no longer a public production entry point.

Cloudflare will manage the Custom Domain DNS record and TLS certificate. The Worker remains the origin for every path on the hostname, so the existing static asset and `/api/*` routing behavior does not change.

## Deployment

1. Validate the updated Wrangler configuration with a dry-run build.
2. Deploy the existing Worker with its current secret-loading workflow.
3. Allow Cloudflare to create the DNS record and provision the certificate.

No source code, D1 schema, bindings, schedules, secrets, or application behavior will change.

## Acceptance Evidence

- `wrangler deploy --dry-run` accepts the configuration.
- A production deployment reports `watchtower.damao.io` as a Custom Domain and does not report a `workers.dev` route.
- Public DNS resolves `watchtower.damao.io` through Cloudflare.
- `https://watchtower.damao.io/` returns the WatchTower application over a valid TLS connection.
- A representative `https://watchtower.damao.io/api/*` request reaches the existing Worker API.
- The scoped Git diff contains only the design document and the intended Wrangler routing changes.

## Rollback

Restore `workers_dev` to `true`, remove the Custom Domain entry from `routes`, and redeploy. This returns public access to the `workers.dev` hostname and removes the Worker Custom Domain mapping. Cloudflare may retain the generated edge certificate after Custom Domain removal; it can be removed separately during certificate inventory cleanup.
