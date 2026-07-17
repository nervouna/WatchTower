# StyleSeed — Design Lock

<!--
Locked design decisions for every WatchTower UI. Re-read this file before
touching UI code. Change a locked value only after explicit user approval.
-->

## Product and surface

- Product: WatchTower
- App domain: daily Chinese technology and product intelligence brief
- Surface: responsive, content-heavy editorial web application
- Mobile surface: Flutter reading application for iPhone, iPad, and Android; it shares this lock instead of introducing a second visual identity
- Primary tasks: scan the latest brief, understand why each signal matters, and browse the archive
- Focal point: the current brief headline; every screen must have exactly one dominant focal point

## Mobile application

- Navigation: three root destinations, `今日`, `归档`, and `设置`; detail and privacy are spoke screens with standard back navigation
- App shell: native safe areas, a compact WatchTower header, system bottom navigation, and a mini audio player only while audio is active
- Offline: show cached text immediately and identify it with last-refresh context; audio remains online-only
- Notifications: explain value in-product before requesting the iOS system permission; Android does not expose notification controls until its provider is implemented
- Accessibility: honor Dynamic Type, VoiceOver/TalkBack order, keyboard navigation, and minimum 44pt iOS / 48dp Android touch targets
- Responsive behavior: preserve the editorial hierarchy on tablets and wide Android windows; do not merely stretch phone cards edge to edge

## Visual direction

- Mood: precise, editorial, calm, focused, and moderately airy
- Composition: one focal point and one accent; supporting content stays neutral
- Base: fresh neutral surfaces, never a beige paper treatment or a dark-heavy brochure layout
- Density: comfortable reading density with compact metadata

## Color

- Key color (the only decorative accent): Radar Cyan `#0E7490`
- Dark-mode accent: `#67E8F9`
- Neutral palette: cool neutral greys for text, surfaces, dividers, inactive controls, and normal states
- Accent use: primary action, links, rank markers, focus treatment, and the screen's focal point
- Forbidden: default indigo, rainbow categories, decorative status colors, and a second emphasis hue
- Semantic resolve: normal and complete states are neutral; amber is reserved for warnings, and red is reserved for errors. Every warning or error also uses text or an icon, never color alone.

## Type

- Font: system UI stack only; no web fonts
- Stack: `system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`
- Display: the same system stack, differentiated through scale, weight, line height, and spacing
- Metadata: the system monospace stack may be used for dates, ranks, counts, and machine-readable identifiers
- Performance invariant: font rendering must require zero font downloads

## Radius personality

- Personality: Soft
- Content surfaces: `10–12px`
- Buttons and inputs: `8px`
- Nested elements: inner radius equals outer radius minus padding
- Pills: reserved for compact tags and status labels; ordinary buttons and cards must not become pills

## Elevation

- Light mode: use surface tone separation first; reserve a subtle, two-layer, low-opacity shadow for genuinely raised surfaces
- Dark mode: use a tonal surface ramp plus translucent hairlines; do not use drop shadows
- Separation invariant: borders must not do all the elevation work in light mode

## Motion

- Motion seed: Snap
- Character: quick, precise, and decisive
- Content: render headlines, ranks, summaries, and data immediately; never animate the payload into view
- Interaction timing: approximately `100–160ms`
- Allowed: short color, background, focus, and small positional transitions for direct interaction or state changes
- Loading: a restrained shimmer is allowed when a real loading state needs it
- Forbidden: staggered article entrances, scroll-linked motion, parallax, bouncing content, animated gradients, and infinite loops other than a loading skeleton
- Reduced motion: remove every non-essential transition under `prefers-reduced-motion: reduce`

## Quality gate

- Build full screens through `$ss-build`.
- Run `$ss-score` against real UI files after every UI build or material UI change.
- Fix and re-score until the result is at least `80/100` before presenting the UI.
- Treat `80` as the shipping floor, not a target to optimize past indefinitely.

Locked: 2026-07-16
