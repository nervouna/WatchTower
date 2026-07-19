# StyleSeed — Editorial Ledger Design Lock

This file is the binding design contract for WatchTower web UI. It supersedes
the former Radar Cyan, soft-radius, and card-surface direction. Mobile remains
out of scope for this lock change.

## Product and surface

- Product: WatchTower, a daily Chinese technology and product intelligence brief.
- Surface: responsive, content-heavy editorial web application.
- Primary tasks: read the latest brief, understand why each signal matters,
  explore supporting evidence, and browse the archive.
- Focal point: the brief headline. Every screen has one dominant focal point.
- Public contract: briefs, archive, audio, transcripts, explorations, and privacy
  remain anonymously readable even when authentication fails.

## Direction

- Name: Editorial Ledger.
- Mood: precise, editorial, continuous, calm, and information-dense.
- Composition: a publication masthead, a narrow issue/index rail, and one reading
  column. Use type, rules, whitespace, and numbered entries instead of cards.
- Reading measure: approximately 60–68 Chinese characters for long-form copy.
- Spacing: an 8px baseline with 20px mobile and 32px desktop page gutters.

## Color

- Light page: `#FCFCFB`.
- Light text: `#171717`; secondary text: `#62666B`; rule: `#D6D7D9`.
- Light accent: editorial red `#B42318`.
- Dark page: `#111315`.
- Dark text: `#F4F4F1`; secondary text: `#A8ADB2`; rule: `#363A3E`.
- Dark accent: `#FF8177`.
- Accent is reserved for links, focus, the active navigation item, and selected
  controls. Normal and complete states are neutral. Errors always include text.
- Forbidden: gradients, glass, glow, decorative status colors, multiple accents,
  and color-only meaning.

## Type

- Editorial display: `"Iowan Old Style", Baskerville, "Songti SC", STSong,
  "Noto Serif CJK SC", serif` for the wordmark, lead brief headline, brief-item
  titles, section headings, and state-page headings.
- Chinese lead headlines use the full reading-column width rather than a
  `ch`-based measure, which produces an artificially square text block for CJK.
- Body and controls: `system-ui, -apple-system, BlinkMacSystemFont,
  "SF Pro Text", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC",
  sans-serif`.
- Fonts require zero downloads.
- Desktop body text is at least 16px. The responsive brief headline ranges from
  approximately 42px to 68px, uses relaxed display leading, and remains the sole
  visual focal point.

## Shape and elevation

- Content surfaces: square, with no radius, fill, or shadow.
- Controls: 4px radius and at least 44px high.
- Account dialog: 8px radius and the only raised surface; a low-opacity shadow is
  allowed in both color schemes.
- Pills and badges are forbidden. Tags are plain slash-separated metadata.

## Motion

- Content appears immediately. No entrance, reveal, scroll, parallax, shimmer,
  spinner, or hover-lift motion.
- Direct interaction transitions use `100–140ms` for color and border only.
- `prefers-reduced-motion` removes non-essential transitions.

## Content and component rules

- Never use cards or nested cards as page structure.
- Use semantic headings, paragraphs, lists, and horizontal rules for continuous
  reading. Buttons are only for state changes or submissions; navigation and
  disclosure-like reading actions retain link styling.
- Do not repeat a heading with an eyebrow or generic explanatory subtitle.
- Archive rows do not display `complete` or `partial` status labels; status remains
  available in the data contract without interrupting date-and-count scanning.
- Audio is a compact horizontal toolbar using native controls; podcast cover art
  is not shown in the web reading flow.
- Feedback, exploration, loading, empty, and failure states use local live regions
  where needed. Never apply `aria-live` to the entire application root.

## Responsive behavior

- Maximum page width: approximately 1360px.
- Above 960px: a 176px issue/index rail plus reading column.
- At 960px and below: index links move below the brief header.
- Below 640px: one column, preserved ranks, no horizontal overflow.
- Verify at 1440×900, 1024×768, and 390×844 in light and dark modes.

## Quality gate

- Build material screens through `$ss-build`.
- Run `$ss-score`, fix, and repeat until at least `80/100`.
- Then run `$ss-verify` against real rendered happy, loading, empty, error,
  archive, privacy, exploration, and account states.
- Re-run the repository lint, typecheck, test, build, and diff checks.

Locked: 2026-07-19
