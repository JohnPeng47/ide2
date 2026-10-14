# Application theme system

The application has two presentations of the same interface: **Current Dark** and
**Neutral Light**. The floating button at the bottom right switches between them.
The choice is saved in this browser, restored before React mounts, and synchronized
across tabs. Dark is the default when no preference is saved. Storage failures do
not prevent switching for the current page.

## Layers

1. `src/app/styles/foundations.css` defines reusable scales: neutral colors,
   typography, spacing, radii, strokes, overlay layers, identity colors, and tint
   settings. These are presentation values, not canvas geometry.
2. `src/app/styles/themes.css` assigns semantic roles for each theme: app, panel,
   canvas and code surfaces; primary/muted text; focus and selection; added,
   deleted and modified code; migrations; grids; and shadows. Both themes implement
   the same contract. Change theme values here, not in component selectors.
3. `src/app/styles/components.css` connects roles to component contracts such as
   `--panel-background`, `--control-background`, `--tooltip-background`, and
   `--treemap-background`. It also adapts established names such as `--bg`, `--fg`,
   and `--accent-cyan`, so existing components participate in the same system.
   Component stylesheets retain their layout and interaction selectors and consume
   these contracts, semantic roles, and foundation scales.

`data-theme` lives on the document root. Portaled tooltips, menus and floating
panels inherit the theme without requiring extra React providers. The native
`color-scheme` is also set, so form controls and scrollbars match.

## Diagram colors and changed code

Node identity is independent of theme: the deterministic position-to-color mapping
uses the foundation identity palette, followed by deterministic hues. Both exclude
green and neighboring lime/teal hues (45–205°), keeping them distinct from added-code
indicators. Theme changes
never change node IDs, LOC allocation, layout or saved diagrams.

The canvas and treemap default to 22% identity opacity, with non-overlapping subtree
fills. The settings button beside the floating theme toggle opens independent
0–100% opacity sliders for diagram treemap tiles and canvas backgrounds. They
update immediately and persist under `new-diagram-color-opacity`, independently
of theme, with cross-tab synchronization. The CSS contracts are
`--treemap-identity-opacity` and `--canvas-identity-opacity`. Neutral Light gives both a white base and neutral grid. Current Dark keeps
the dark canvas and navy Blueprint surfaces. Treemap tiles use plain identity fills and neutral outlines; added/deleted LOC
remain in the inspector and in hover tooltips (green additions, red deletions). Entirely added diagrams use their green boundary without
repeating the green fill on every text label. Mapped labels remain clickable without
a dotted underline. Text/fill/border roles for other diff rows remain separate. Authored connection colors remain document data.

## Rendering adapters

`src/shared/theme/themeDefinitions.ts` names the themes and their code palettes.
Source highlighting uses `dark-plus` / `light-plus`; embedded Markdown uses
`catppuccin-mocha` / `catppuccin-latte`. Highlight caches include theme identity.
The native tldraw renderer receives the same light/dark mode. Standalone exported
terminal Markdown documents keep their existing self-contained dark presentation.

`theme.ts` manages the selected theme without remounting the workspace. The toggle
is keyboard accessible, names the destination theme, and has a compact icon form
on narrow screens. Fonts and canvas coordinate sizes do not change between themes.

## Extending the system

Use a semantic role when the meaning is shared, a component alias when a widget
needs an independent styling contract, and foundation values for reusable scales.
Do not add raw UI colors to feature stylesheets. User-authored colors and captured
source-code tokens are data and should not be rewritten as application tokens.

To add a theme, extend the theme name/configuration, implement every semantic role,
and add it to the selection UI. Verify light/dark contrast, selected and disabled
states, diff rows, canvas overlays, code views and portaled tooltips. The contract
and syntax-palette tests live in `src/shared/theme/__tests__/themes.test.ts`.
The treemap browser check exercises the floating control, keyboard input, reload
persistence, matching canvas/tile fills, and unchanged layout and LOC values.
