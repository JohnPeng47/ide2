# Handoff validation

Checked September 10, 2026 against the completed handoff files.

- Copied source files match their manifest SHA-256 hashes and original working files byte for byte.
- Extracted/generated source records match their output hashes; JSON files parse and local HTML asset links resolve.
- The final static guide was served from a disposable local server and checked in headless Chrome through CDP at 1440 × 1000 and 390 × 844. No build step is needed for this static HTML/CSS artifact.
- Verified stylesheet loading, background color, diagram font size, image loading, and no page-level horizontal overflow at either width.
- Pointer checks verified primary-button hover, active-tool toggle, output-kind selection, and the local import specimen. Keyboard Tab produced the existing 2px visible focus outline.
- The Markdown iframe rendered at 13px with a real Shiki code block. Desktop screenshots were visually inspected.

This validates the handoff guide, not the live app's canvas behavior or an accessibility conformance level. The production app was not modified or rebuilt. Temporary browser profiles, server, check scripts, and screenshots were removed after review.
