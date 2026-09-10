# New Diagram — design handoff

A snapshot of the existing product design, captured from this repository on September 10, 2026. Use this as the baseline for design iterations that should remain consistent with the app.

**Start with [preview/index.html](preview/index.html)**: open it directly in a browser; no installation, server, or network connection is required. It shows the actual product CSS on representative components, plus an isolated Markdown specimen. The specimen content is fictional and its arrangement is for review, not a screenshot of a product screen.

| Folder | Contents |
| --- | --- |
| `styles/` | Complete product CSS, extracted Markdown CSS, separate Mapping UX variant, and developer overlay CSS |
| `foundations/` | Palette, literal CSS/JSON tokens, typography, layout/state guidance, and a searchable declaration inventory |
| `assets/` | Editable palette SVG, derived ND mark and connector SVG, font information, and the two installed syntax themes with their license |
| `reference/` | Original component/rendering source for implementation context, source map, and a dated hash manifest |
| `preview/` | Offline visual reference using the bundled styles |

Read [foundations/guidelines.md](foundations/guidelines.md) before designing. Preserve the dark surfaces, compact hierarchy, monospace diagram geometry, thin rules, and existing component state cues. Document deliberate departures so they can be evaluated with the product team.

The main app's `src/styles.css` is the primary baseline. `mapping-ux-variant.css` is a complete alternative snapshot with additional source-pane styles; **do not load both product sheets together**. Markdown CSS belongs in a separate document/iframe. Developer overlay styling is supplementary, not a product theme.

Fonts are system stacks: no font binaries or webfont loading exist in the app. See [assets/fonts/README.md](assets/fonts/README.md). Source TSX is reference material with unresolved application imports, not an installable UI library. Token JSON is a simple reference format, not an automatic Figma import. The app is not wired to this folder; it is a portable handoff snapshot. Provenance and refresh instructions are in [reference/README.md](reference/README.md).
