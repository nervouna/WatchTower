# Web UI Guidelines

- Read `../STYLESEED.md` before editing this directory. Do not change locked values without explicit user approval.
- Preserve the single Radar Cyan accent, system font stack, Soft radius rules, Snap motion, neutral supporting palette, responsive editorial hierarchy, and one dominant focal point.
- Keep headlines and brief items immediately available. Do not hide payload content behind entrance or scroll animations, and respect `prefers-reduced-motion`.
- Preserve semantic HTML, keyboard operation, visible focus, appropriate touch targets, loading/error/empty states, and accessible light/dark contrast.
- For a material UI change, use the repository StyleSeed workflow, score the real UI with `$ss-score`, fix findings until it reaches at least `80/100`, and use `$ss-verify` as the final gate when the UI can be rendered. State when visual verification is unavailable.
- Keep account, capability, feedback, and deletion behavior synchronized with the runtime contract. For payload, API, authentication, or feedback changes, also use `$maintain-watchtower-worker`.
- Let the Auth0 SPA SDK keep access tokens in memory. Never copy them into `localStorage`, `sessionStorage`, cookies, the DOM, or logs.
- On a protected request, retry one token refresh after `401` and sign out only if it still fails. Treat `403` as capability revocation without discarding a valid login session.
- Auth configuration and silent-login failures may disable account and feedback features, but must not hide or block public content.
