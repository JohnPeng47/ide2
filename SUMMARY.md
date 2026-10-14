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

## Decision so far

The user picked **#3 Blueprint** for implementation in `ChangeTreemapContent.tsx` / `changeTreemap.css`.
It has not been implemented yet.

## Open issue: box edges don't align ("fragmentation")

The user shared a screenshot of the current treemap where tile edges do not line up. The suspected causes:

1. **Cumulative nesting inset.** Each nested region is placed at `left: 2px; top: 28px` inside a cell that
   already has a 2px border, with size `rect.width - 8` × `rect.height - 34`. Every nesting level pulls
   children ~4px in from the sides and ~30px down. A deep tile's edge then sits several px inside the
   top-level region edge, while a shallower neighbour sits flush, so a seam that should be one
   continuous line becomes a staircase.
2. **Double borders.** Each cell draws a 2px dark border and its inner `<button>` draws another 1px
   coloured border further in, so two outlines run at different offsets.
3. **Fractional coordinates.** `treemapLayout` returns non-integer rects. Antialiasing makes some gaps look
   2px and others 3px.

Proposed fix (presentation only, no weighting change):

- Snap each rect's *edges* to integer pixels (`x0 = round(x)`, `x1 = round(x + w)`, same for y) so
  neighbours share exact edges.
- Use one uniform gutter: a single 1px inset and a single 1px outline per tile, with no inner button border.
- Render all tiles in one shared coordinate space (flatten the tree, as the designs do) rather than nesting
  absolutely positioned divs inside bordered cells.
- Either make nested regions flush (only a header strip, no side/bottom padding, so seams continue
  straight), or keep a small inset that is identical on every side and level. **This choice is still
  open.** The user wasn't yet sure they understood the problem and wanted to investigate locally first.

## Next steps

1. Reproduce the misalignment locally and confirm the causes above.
2. Decide flush nesting vs. uniform inset.
3. Port the Blueprint look into `ChangeTreemapContent.tsx` / `changeTreemap.css`, keeping
   `treemapLayout` and `changeTreemap.ts` unchanged. Run `npm test` and `npm run typecheck`. The existing
   `src/features/mapping/changes/__tests__/treemapLayout.test.ts` must still pass.
