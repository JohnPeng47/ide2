# Session summary: change-treemap presentation alternatives

## Context

- The change-session treemap lives in:
  - `src/features/mapping/changes/ChangeTreemapContent.tsx` (rendering, selection, zoom, breadcrumbs)
  - `src/features/mapping/changes/changeTreemap.css` (styling)
  - `src/features/mapping/changes/treemapLayout.ts` (balanced binary partition layout)
  - `domain/mapping/changes/changeTreemap.ts` (builds the Files / Diagrams trees and LOC allocation)
- It was introduced in commit `808aca3` ("Add change-session treemaps with shared LOC allocation and
  diagram navigation"). This branch was fast-forwarded onto `claude/diagram-ai-modal-design-6xhqax` to get it.

## What was done

Four alternative *presentations* of the treemap were designed. **The weighting algorithm was
deliberately left untouched**: every design reuses `treemapLayout` verbatim, the same `node.value`
weights, and the same nesting rule (`depth < 2 && children && rect.width > 140 && rect.height > 100`).
Only colour, labelling, borders, gutters and panel chrome differ.

The designs are in `docs/designs/treemap-alternatives/` (Design-canvas `.dc.html` artboards and their
`canvas.json` index). They render on the claude.ai Design canvas, which supplies `support.js`. They will
not run as standalone HTML. Each file's `<script type="text/x-dc">` block holds plain JS for the tree,
layout and styling logic. They use **sample data**: paths are from commit `808aca3`; some deletion counts,
the Diagrams tree and the "46 duplicate discounted" figure are invented.

| File | Name | Idea |
|---|---|---|
| `Main.dc.html` | 1 · Diverging heat | Continuous orange→grey→blue fill by (added − deleted)/total; 1px gutters; big LOC number on large tiles |
| `Ledger.dc.html` | 2 · Ledger tiles | Neutral tiles, LOC number as headline, added/deleted split bar on each tile's foot; summary as an allocated/unmapped meter |
| `Blueprint.dc.html` | 3 · Blueprint | Monospace, grid background, outline-only tiles stroked by dominant tone, hatched band = deleted share, dashed frames for directories, title-block inspector |
| `Cushion.dc.html` | 4 · Cushions + ranked list | Depth shown by lightness, tone strip on top, ranked bar list of the focused level with tile/row hover sync |

## Implemented direction

Blueprint (#3) is now implemented in `ChangeTreemapContent.tsx` and
`changeTreemap.css`: navy grid, monospace labels, green/orange/neutral outlines,
added/deleted-share hatching at equal opacity, dashed group frames, compact four-column totals, and a
region inspector styled as a drafting title block. Totals wrap to two columns in
compact panels. Real ChangeSession data replaces the mockup's sample data.
Hover/focus tooltips show the containing diagram, node, and share of total session
changed LOC; the percentage denominator stays fixed across zoom levels.
Zoomed views have sticky Zoom out / Reset zoom controls to return one level or
to the complete map without hunting through breadcrumbs.

Existing behavior is retained: Files/Diagrams, equal LOC allocation, Unmapped,
breadcrumbs, region selection, explicit zoom, and rectangle clicks that navigate
to the proposed diagram and minimize the panel. No source-code split pane was added.

## Subtree identity colors

`treemapDiagramColors.ts` assigns each node a fixed color by preorder position in
the full diagram hierarchy (excluding Unmapped). Direct-allocation tiles reuse
their target parent's color. Positions are independent of zoom and layout.

Visible treemap nodes tint their corresponding canvas subtrees, including their
descendants and diff rows. Zoom reveals finer colors. `treemapCanvasTiles.ts`
partitions the entire containing diagram, retaining parent colors in remaining
space without stacking translucent fills. Assignments are scoped by session,
document, display node, and content node; Files mode and closing Treemaps clear
the tints. Green/orange hatching and LOC allocation are unchanged.

Browser checks verify distinct parent/child colors, matching subtree labels,
whole-diagram coverage without overlaps, navigation, zoom, reopening and cleanup.
Geometry tests cover modified label pairs, siblings and folded descendants.
The production build, 21 focused tests, and browser check passed; Proposal 2 was
also inspected live with matching editContexts colors in the treemap and canvas.

## Box alignment: investigation and fix

The browser confirmed each old nested level added a **4px side inset / 30px top
inset**, with both a 2px cell border and a 1px button border. This accumulated
into stepped edges. Layout coordinates were also fractional.

The implemented presentation uses **flush nesting**: child regions share their
parent's left, right, and bottom edges, with only a 22px heading reserved above.
All rendered cells are siblings in the same coordinate space. Shared edges are
rounded to pixels (not widths independently), with a uniform 1px visual inset
and one outline per tile. Group frames are dashed and leaf tiles have solid
outlines; there is no second border on the cell wrapper.

`treemapLayout.ts` and `domain/mapping/changes/changeTreemap.ts` remain unchanged.
The existing depth/size nesting thresholds are preserved. Pixel snapping is a
rendering step; fractional LOC weights remain intact.

## Validation

The browser check in `tests/browser/mapping/browser-change-treemaps-check.mjs`
now verifies shared pixel-aligned edges at every rendered depth, wide and compact
layouts, the blueprint grid, one-third deletion hatching, unchanged LOC totals,
zoom, direct diagram navigation, empty/binary states, and read-only behavior.
Production build, standalone `npm run typecheck`, and the browser check pass.
The full suite passed 738/739 tests; the existing 5-second timeout in
`projectProjection.test.ts` recurred under load, then all six tests in that file
passed when rerun alone. Proposal 2 was also inspected in the live application
in expanded and compact modes; its actual total remains 2,111 LOC.

## Theme system

Current Dark and Neutral Light now share foundations, semantic roles and component
contracts under `src/app/styles/`. Feature CSS consumes those tokens; a floating
toggle switches the document theme and persists the choice. Neutral Light uses
matching white canvas/treemap surfaces with dark labels. Code/Markdown highlighting
and the native canvas follow the theme. See `docs/guides/theme-system.md`.

Theme validation: production build and the full treemap browser flow passed,
including light/dark surfaces, identity tint parity, keyboard activation and
persistence after reload. Theme/source/Markdown contract tests passed. The full
suite initially passed 743/750; all seven failed cases passed after updating the
App expectation and rerunning the affected files (concurrent workflow work and
two persistence timeouts). Proposal 2 was inspected in Neutral Light live.

## Treemap presentation refinements

Treemaps now use plain identity fills and neutral outlines, with no added/deleted
hatching. Hover tooltips include green +added and red −deleted LOC. The identity
palette and generated hues exclude green, lime and teal (45–205 degrees).
The floating theme control has an adjacent settings button for independent
treemap and diagram background opacity sliders; both persist across reloads.
Entirely new diagrams retain their green boundary without green text highlights;
mapped labels remain clickable without dotted underlines. Canvas tint offsets
were caused by copying a scene origin into local tile bounds and adding it twice;
whole-diagram tiles now use only the bounds' dimensions before final placement.
Regression checks cover nonzero scene origins, partition coverage, slider
independence and persistence, and tooltip additions/deletions in both themes.

## Shared regular-canvas treemaps

Regular canvases now have a Treemaps toolbar button opening the same shared
`TreemapContent` renderer used by ChangeSessions. Both panels remove the bottom
inspector/dropdown/footnotes and fill the remaining space with tiles. Zoom in sits
beside the breadcrumbs and applies to a selected region with children; Zoom out
and Reset appear after drilling in. Tile navigation keeps the panel open and
centers native canvas nodes beside the visible panel.

Canvas scope defaults to Mapped ranges (unique verified mapped lines per file),
with Referenced files counting complete referenced files and showing unmapped
lines as a separate tile. Scope persists in browser storage. Physical LOC includes
blank/comment lines but excludes the phantom line after a terminal newline.
`domain/mapping/treemap/canvasTreemap.ts` sweeps range boundaries, deduplicates
repeated mappings to the same node, and divides overlapping lines among distinct
destinations. Source identity includes repository/corpus/revision and path.
The active live scene supplies hierarchy/mappings, including folded diagrams.
Current files are read through the existing codeRepo worker with six concurrent
reads; opening, window focus, and Refresh sources refresh file contents. Missing,
binary, stale, and unresolved mappings are reported instead of guessed.

Regular-canvas tooltips show scope percentage and source LOC (no diff +/-), with
the same colors/opacity controls and partitioned native-shape backgrounds.
Source mappings and diagram documents are never generated or changed by this view.
Checks: `npm run check:canvas-treemaps`, `npm run check:change-treemaps`, allocation
and canvas tile unit tests, and architecture dependency tests.

Validation for the shared view passed: production build, 14 focused unit/architecture
tests, and both regular-canvas and ChangeSession treemap browser flows. Screenshots
were inspected in light mode, including the selected canvas node beside the panel.

## Blue LOC shading experiment

Replaced rotating identity hues with one blue scale derived from each tile's LOC.
Equal values share a shade; maximum comes from the complete map excluding
Unmapped and remains fixed while zooming. The legend shows 0 and that maximum.
Dark mode increases brightness/saturation for higher LOC; light mode darkens it.
Files also use the scale. Unmapped retains its neutral fill. Canvas tints match
the visible tiles; direct-allocation tiles use their own weight, leaving the
parent heading row in its aggregate shade. Position now controls paint order only.
The floating theme settings add a shared Shade shift slider (−20…+20 lightness),
persisted with the independent opacity preferences; older settings default to zero.
Build, color/tiling/theme unit tests, and both treemap browser flows passed, including
shade changes in both views and reload persistence. Dark/light screenshots inspected.


### Ranked treemap shading and canvas hover

The floating appearance panel now offers Ranked (default, including legacy preferences)
and Continuous blue LOC scales. Ranked spreads distinct positive values from the complete
hierarchy evenly over the shade range; ties share a shade. Aggregate headings participate,
Unmapped/root do not. Zoom leaves the reference scale fixed; LOC/area remain unchanged.
The setting persists with opacity/shade controls. Both source and diff treemaps publish
matching canvas shades. Hover or keyboard focus adds a blue outline around the matching
canvas subtree's region via shared projected region geometry, without invoking navigation.
Leaving/blur/closing clears the transient highlight.

Validation: production build, seven focused unit tests, and both source/diff browser
checks pass, including scale switching/persistence and hover without camera movement.


### Canvas-first DiffSession treemaps and reverse selection

DiffSession diagram treemaps now group All canvases → canvas → diagram → subtree.
Canvas totals aggregate their allocated changed LOC; unmapped hunks remain at the
session root. Regular canvas treemaps retain their existing hierarchy. Canvas groups
navigate by document ID, while descendant nodes retain exact diagram/subtree targets.

While diagram treemaps are displayed, clicks on painted canvas regions select the
corresponding tile, reveal its containing treemap group if needed, and focus it to
show the tooltip and blue canvas outline. The shared pointer observer hit-tests the
partitioned backgrounds; source links/controls and drags remain independent. It never
invokes canvas navigation. DiffSession text no longer opens mapped DiffTree jump menus.

Validation: production build, 11 focused unit tests, and regular/diff treemap browser
flows passed, including reverse selection, fixed cameras, canvas grouping/totals,
settings, zoom and source scopes. The broader DiffTree browser script currently
stops at its earlier search-panel Escape assertion, before the changed click checks.


### Compact treemap tooltips

Tooltips now show only LOC and, for DiffSessions, green +added/red −deleted counts
on one compact row. Removed names and percentages. Positioning uses the full tile
rectangle (including nested regions), choosing right/left/above/below with an 8px
gap and viewport containment, never clamping back over the hovered box. The same
placement applies to keyboard focus and canvas-to-treemap selection. With no valid
outside space the tooltip stays hidden. Geometry tests cover small edge tiles,
large regions and the no-space case; browser checks assert no overlap.

Compact tooltip validation passed: production build, placement edge-case tests,
and both source/DiffSession browser checks with compactness and non-overlap assertions.

Tooltip follow-up: restored LOC percentage beside the count in both views. It uses
total session/scope LOC (including unmapped), not the zoomed region subtotal.


### Panel-owned agent context and session ID

Each `PromptComposerEntry` now owns a stable `llmSessionId` and the latest successful
`AgentContextSnapshot`. Create, extend, and update requests send that snapshot back
with fresh canvas inputs. The runtime captures user/assistant/tool messages after a
validated submission, and the application publishes the next context only after the
canvas change is acknowledged. Failed/cancelled/conflicting requests preserve the
previous context; transport/persistence retries reuse their exact original request.
Multiple creations in one request chain the same conversation.

Hiding/reopening a composer preserves its context; dismissing it or reloading the
page starts fresh (composer state remains in memory). Separate panels have separate
identities. Inline snapshots use existing hash/size/tool-pair validation and must
match the panel identity. Existing uploaded `agentContextId` calls remain supported.

The composer footer offers **Copy agent session ID** once generation starts. This
copies the latest actual Pi runtime ID, with copied/error feedback. Each generation
still uses a fresh disposable Pi runtime seeded from the panel's accumulated context;
the persistent conversation identity and per-generation runtime ID are distinct.

Validation: production build and 52 focused tests passed (panel lifecycle, retry
identity, snapshot validation, transcript capture, and persistence acknowledgement).
The disposable CDP browser flow verified clipboard contents and a second generation
with the previous conversation after hiding/reopening the same panel, plus isolation
of a new panel. No real model calls were used.
