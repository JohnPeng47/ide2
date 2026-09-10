# Fonts

The product does not bundle font files, declare `@font-face`, or download a webfont. These are the exact declared stacks, tried in order:

| Context | Stack |
| --- | --- |
| Product sans (`--font-sans`) | `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` |
| Product mono (`--font-mono`) | `"SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", monospace` |
| Standalone Markdown | `"SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace` |
| Developer test overlay | `ui-monospace, "SFMono-Regular", Menlo, Monaco, Consolas, monospace` |

Inter is a preferred local font name, not a shipped dependency. The font actually rendered depends on the review machine. There are no font binaries to extract from this product. Use a locally available member of the stack in design files and record which font and operating system you used; this folder does not supply font licenses or installation files.

Diagram and source text must remain monospaced. The app measures rendered character width and line height for selection rectangles and canvas geometry. Changing fonts, letter spacing, line height, wrapping, or ligature behavior needs a corresponding geometry check. Do not outline diagram text or replace it with proportional text in implementation specifications.

The SVG ND mark contains live text with the same mono stack; its exact glyph appearance also depends on installed fonts. The product's HTML/CSS mark in the preview is the rendering reference.
