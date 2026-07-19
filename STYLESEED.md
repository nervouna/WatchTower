# StyleSeed — Editorial Ledger Design Lock

<!-- Locked contract for WatchTower Web and Flutter. Change only with explicit approval. -->

## Product and surfaces

- Product: WatchTower, a daily Chinese technology and product intelligence brief.
- Surfaces: responsive editorial Web plus Flutter reading applications for iPhone, iPad, and Android.
- Identity: precise, calm Editorial Ledger. The current brief headline is the single focal point.
- Structure: continuous reading surfaces, restrained metadata, hairline rules, and one accent. No cards, decorative icon plates, gradients, shadows, or pill-shaped labels in editorial content.

## Color

| Token | Light | Dark |
| --- | --- | --- |
| Page | `#FCFCFB` | `#111315` |
| Text | `#171717` | `#F4F4F1` |
| Secondary | `#62666B` | `#A8ADB2` |
| Divider | `#D6D7D9` | `#363A3E` |
| Accent | `#B42318` | `#FF8177` |

- Accent is reserved for links, rank markers, focus, and primary actions.
- Normal, complete, selected-cache, and success states remain neutral. Errors use accent plus explicit text, never color alone.

## Typography

- Display serif, without bundled assets: iOS `Iowan Old Style`, `Baskerville`, then `Songti SC`, `STSong`; Android `Noto Serif`, `Noto Serif CJK SC`, then the platform Chinese fallback.
- Body and controls: system sans serif. iOS uses SF/PingFang SC; Android uses Roboto/Noto Sans CJK.
- Brief headline: 34–38pt phone, 42–48pt tablet, 1.16 line height, left aligned, full reading width.
- Item title: 24–28pt serif at about 1.28 line height. Page and section headings: 22–28pt serif.
- Body: at least 17pt with 1.6–1.7 line height. Metadata: 13–14pt. Only machine identifiers use monospace.
- Honor Dynamic Type. Never disable scaling, fix text-bearing heights, or truncate prose with `maxLines`.
- No font assets or font downloads. Real glyph fallback and mixed-script baselines are simulator acceptance evidence, not golden-test inputs.

## Mobile application

- Root navigation remains `今日`, `归档`, `设置`; history, privacy, and exploration are spoke screens with standard back navigation.
- Root app bars are compact: serif `WatchTower` on Today and the page title elsewhere. No app icon or duplicate date.
- Bottom navigation has no selected indicator pill. Use a top hairline, accent selected state, and neutral unselected state.
- The mini player is a flat, hairline-separated row above navigation with play/pause, one-line title, and close.
- Reading order: date/update, headline, intro, source coverage, audio toolbar, `01–NN` issue navigation, articles.
- Width: 20px phone margins and a 680–760px wide reading column. Use an 8px spacing baseline.
- Controls use 4px corners; confirmation dialogs may use 8px. Editorial surfaces remain square and transparent.
- Minimum targets: 44pt on iOS and 48dp on Android. Preserve visible focus, VoiceOver/TalkBack order, keyboard activation, and link semantics.

## States and motion

- Loading, empty, offline, error, and partial-result states retain the real shell and page title. Use serif headings, concise text, a clear next action, and static text skeletons.
- No fullscreen spinner, shimmer, content entrance, scroll animation, parallax, animated gradient, or nested scroll surface.
- Direct interaction keeps only short platform feedback. Root tabs continue to use `NoTransitionPage`.
- Offline text, network refresh, authentication, audio, and push must degrade independently.

## Quality gate

- Run `$ss-score` on real Flutter UI sources and fix/re-score to at least `80/100`.
- Then run `$ss-verify` against actual 2× simulator screenshots in light, dark, default text, and an accessibility text size. Inspect every primary screen plus important loading, empty, error, offline, audio, and account states.
- Do not use host-font-dependent goldens. The visual gate passes only after the rendered screenshots were actually viewed.

Locked: 2026-07-19
