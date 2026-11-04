# ASCII graph fixtures

`cN-alt-slot-M.txt` is diagram M from canvas N, taken verbatim from eval runs that
all used the same prompt and inputs. Canvases c1–c4 come from runs 26, 27, 29 and
30. Canvas c5 comes from run 25: run 28 failed, and run 25 is the parent run, which
used the identical prompt.
`cN-alt-slot-M.expect` holds the hand-written expected interpretation, written in
the DSL below. `resolveExpectation` converts it into boxes with exact cell bounds.

## Model

- **Box**: one block of text. `text` holds the box's lines, each trimmed and
  joined with `\n`. `rect` is `{line1, col1, line2, col2}`: one-based,
  inclusive, and the union of every text line in the box. Tree markers and wires
  are never part of a box.
- **contains**: tree structure. Each box has an optional `parent`.
- **Edge**: `{from, to, direction: '->' | '<->' | '--', label?}` between two boxes.

## Rules

1. **Decoration**: rules made only of `=` or `-`, and blank lines, are not boxes.
2. **Tree items**: text after a branch marker (`+--`, `'--`, `` `-- ``, `|--`,
   `+->`) is one box, up to the end of the line or the start of a long arrow.
   Wide spacing inside a tree item does not split it. The parent is the nearest
   item or root with a shallower marker that is joined to it by the trunk.
3. **Continuation**: an unmarked line directly below a box's last line joins
   that box when any of these holds:
   - its text starts to the right of the box's first column (for a tree item,
     at or right of the item's text column), and the box has no tree
     children yet;
   - it starts in the box's first column, and the box is a *flat paragraph*
     (every line so far starts in that column);
   - it starts in the same column, and the box's previous line ends in `;` or
     `,` (a wrapped list).

   Exceptions: a same-column line that starts with a `Word:` label (such as
   `Sources:`) starts a new box, and so does text that a horizontal arrow
   points at.
   A line made only of wires, or a blank line, ends the continuation.

   Any other unmarked line starts a new box. If that box is indented to the
   right of an earlier box in the same block that already has children, it
   becomes an unmarked child of that box. The exception is a box that is the
   target of an arrowhead: it is always a root.
4. **Segments and columns**: on unmarked lines, a run of 3 or more spaces
   splits the text into segments. A segment that starts with `=`, `<`, `-` or
   `:` rejoins the segment before it (`id         = key`,
   `document    <-> fs`). A row is in *column context* when the row above it
   has several segments, or when this row also holds wire cells. In column
   context, a segment continues the box above whose cells it overlaps, if it
   starts no more than 2 columns left of that box's first column. Tree-item
   text also ends at a 3-space gap in column context.
   Otherwise, a row with several segments indented below a single box starts
   one new box per segment, each a child of that box. The exception is a
   key/value table: if the row's later columns start where a word follows a
   2-space gap in an adjacent row, the row is one continuation line. On a box's own rows, gaps of
   1–2 spaces are ordinary text, and the line keeps its full span.
5. **Short arrows are text**: `->`, `<-`, `<->`, `-->`, `--x-->` and `|`
   between words are part of the text. A horizontal arrow is an edge when at
   least 3 horizontal glyphs touch its head (`--->`, `<---`), or when it
   sits on a row that a vertical arrowhead lands on. In
   `--label--->`, the text between the dash runs is the edge label. A row that
   starts with an arrow continues the source of the arrow row above it.
   An arrow of any length between bracketed labels (`[A] --> [B]`) is an
   edge.
6. **Edge endpoints**: an edge connects the box its wire touches. A wire that
   leaves the trunk of a tree, or the line just below a tree's last row from a
   marked tree item, attaches to that tree's root. A head attaches to the box
   that starts on the next row (or on the head's own row) under it, or the
   nearest such box within 8 columns. A fan with one head still gives `--`
   edges to its unheaded branches. An arrowhead attaches to the box it points
   at. A vertical wire with no head has direction `--`.
7. **Edge labels**: a label is text that a vertical wire passes through (a `|`
   above it and a `|` or `v` below), unless it starts in the same column as
   the text the wire leaves (then it is a chained box). Text that ends one
   space before a `v` head is also a label.
8. **Gaps and loops**: a wire end reaches the nearest box in its column across
   blank cells. An edge whose two ends are the same box is dropped.
9. **Anchors**: markers such as `[A]` are ordinary boxes and can be edge targets.
10. **Frames**: the text between a frame's borders (`+---+` and `|`) forms one
    cell box, and blank rows inside a cell do not split it. Borders may be
    off by one column. Cells are children of the box directly above the
    frame.
11. **Wide segments**: in column context, a segment that overlaps more than one
    box above starts a new box.
12. **Line text**: each box line is the raw slice from its first segment's
    start to its last segment's end, so a wire between two segments of the
    same box stays in the text.

## DSL

```
# comment
Root text                       <- box. A child is indented 2 more spaces.
  Child text #id                <- an optional id, used by edges
  + continuation text           <- next line of the box above (same indent + '+ ')
  Other child @L12              <- line hint for text that appears more than once
edge "Root text" -> #id : label <- endpoints: "first-line text" or #id
```
