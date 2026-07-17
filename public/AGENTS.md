# Web UI Guidelines

- Read `../STYLESEED.md` before editing this directory. Do not change locked values without explicit user approval.
- Preserve the single Radar Cyan accent, system font stack, Soft radius rules, Snap motion, neutral supporting palette, responsive editorial hierarchy, and one dominant focal point.
- Keep headlines and brief items immediately available. Do not hide payload content behind entrance or scroll animations, and respect `prefers-reduced-motion`.
- Preserve semantic HTML, keyboard operation, visible focus, appropriate touch targets, loading/error/empty states, and accessible light/dark contrast.
- For a material UI change, use the repository StyleSeed workflow, score the real UI with `$ss-score`, fix findings until it reaches at least `80/100`, and use `$ss-verify` as the final gate when the UI can be rendered. State when visual verification is unavailable.
- Keep feedback labels and behavior synchronized with the runtime contract. For payload, API, or feedback changes, also use `$maintain-watchtower-worker`.
