# Existing foundations and component guidance

This describes observed implementation, not a newly standardized scale. Exact component declarations and exceptions are in `style-inventory.json` and the bundled CSS. The preview's `guide-*` classes only lay out the handoff document.

## Visual language

Dark, information-dense workspaces with thin borders and restrained accent fills. Sans text establishes the product title and section hierarchy; monospace text carries controls, metadata, diagrams, source, and terminal documents. The ND brand is a 30 × 30 px cyan outline with live text, alongside the uppercase NEW DIAGRAM wordmark. The repository has no product image library, icon font, or raster logo. Controls use text and glyphs such as `+`, `−`, `×`, and stars; connectors are procedural SVG paths.

## Typography

Values below come from `styles/product.css`; rem conversions assume the browser's normal 16 px root size (the app does not set a root font size).

| Role / selector | Existing specification |
| --- | --- |
| Brand title `.brand h1` | Sans, 0.9rem, 0.16em tracking; browser bold heading weight |
| Pane title `.pane-header h2` | Sans, 1.05rem, weight 600 |
| Eyebrow `.eyebrow` | Mono, 10px, weight 600, 0.13em tracking, uppercase |
| Main action `.button` | Mono, 11px |
| Pane tabs | Mono, 9px, weight 700, 0.08em tracking, uppercase |
| Mapping diagram `.mapping-poc-ascii` | Mono, 13px / 1.4 (18.2px line height), preserved whitespace |
| Source `.source-code-viewer` | Mono, 12px / 1.55 (18.6px line height), tab size 4 |
| Terminal Markdown document | Mono, 13px / 1.5 (19.5px line height), code tab size 2 |
| Chat transcript | Mono, 9px / 1.5; some labels are 7–8px |

The existing small text sizes are a baseline to review, not a claim of accessibility compliance. Include default, hover, focus, active, disabled, loading, empty, and error states in design proposals. Retain labels or structural cues alongside color.

## Spacing, shape, and layering

There is no global spacing or radius token scale. Common observed values are 0.35–0.75rem inside compact controls, 1–1.25rem around pane content, and 1px rules. Avoid silently rounding existing values into a new scale.

| Element | Existing geometry |
| --- | --- |
| Studio shell | 58px top row, then available-height workspace |
| Pane tabs / pane header | Minimum 36px / 78px respectively; specialized headers vary |
| Workspace divider | 9px interaction strip around a 1px visible rule |
| Button | 4px radius, 0.55rem × 0.75rem padding |
| Import inputs | Minimum 36px high, 4px radius |
| Import dialog | Up to 760px wide, 7px radius, 1px gutter border |
| Settings dialog | Up to 1080px wide, 7px radius |
| Status / kind pills | 999px radius |
| Import elevation | `0 22px 80px rgb(0 0 0 / 48%)` |
| Settings elevation | `0 24px 90px rgb(0 0 0 / 55%)` |

The app fills the viewport; panes own their scrolling. Mapping chrome is outside the canvas transform. Diagram, selection, projection, and chat positions use canvas geometry; preserving their spatial relationships is part of the design. See the copied layout and component source for exact rules.

Import and settings backdrops use z-index 20 and 30, respectively; local canvas layers have their own stacking contexts. The developer overlay uses 1000. Do not treat all z-index declarations as one global stacking scale.

## Color and states

See `palette.md` for root values. Cyan marks primary actions, focus, selections, and projected source. Green appears on finalized/success states and chat; purple on output-kind choices and detail/agent cues; yellow on active tools, progress, and stars; red on errors and destructive hover states. These are recurring uses, not universal status aliases.

Buttons are transparent and outlined. A primary button has a cyan border and label; hover adds cyan at 8% opacity. A generic `.button.is-active` uses yellow. Active pane tabs use a cyan inset underline; output-kind pills use purple. Disabled buttons use `#50535a`, with some component-specific opacity rules. The global focus indicator is a 2px cyan outline with 2px offset, with documented component overrides in CSS.

Selection rectangles use a 1px cyan border, 7% cyan fill, and a 14% cyan outer rule; source selections use an 11% fill and 2px inset cyan stripe. Keep the underlying text readable and selections aligned with character cells. Error messages remain textual (`.inline-error`), not color alone.

## Responsive behavior and motion

The current CSS contains component-specific conditions at 640, 760, 800, 840, and 1100px, plus a touch/coarse-pointer condition up to 900px. Consult the inventory's `mediaQueries` for the exact conditions and rules. The product is a desktop workspace; these rules do not establish a complete mobile design system.

Divider transitions use 120ms ease; selection feedback uses 140ms ease. Progress states also use pulses and rotation (all keyframes are included). No reduced-motion override exists in the captured product CSS. If revising motion, include a reduced-motion state as a proposed addition.

## Design iteration checklist

- Reuse the existing palette and component patterns; label any new tokens or variants as proposals.
- Show representative dense screens with long titles, code, empty content, and error states.
- Preserve mono grid alignment, pane scroll boundaries, keyboard focus visibility, and active/selected distinctions.
- Include default and interaction states, and specify font choice, dimensions, and intended responsive behavior.
- Treat Markdown's Catppuccin Mocha and source code's dark-plus as separate existing syntax palettes.

Known inconsistencies are retained: the product CSS refers to `--panel` and `--text` without defining them globally, and some declarations repeat with later overrides. The complete stylesheet and its cascade are authoritative. Consolidating these is a possible future implementation task, not a change made by this handoff.
