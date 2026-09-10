# Source references and provenance

`manifest.json` identifies the capture time, repository HEAD, source paths, output paths, and SHA-256 hashes. It captures working files, so the recorded commit is context rather than a claim that every copied file matches that commit. The Mapping UX variant had local changes at capture time.

The main app imports `src/styles.css` from `src/main.tsx`. The following map helps locate behavior beyond CSS:

| Pattern | Copied source under this folder |
| --- | --- |
| Pane tabs and splitters | `src/core/panes/PaneWorkspace.tsx` |
| Import dialog and forms | `src/core/components/ImportArtifactDialog.tsx` |
| Source colors, lines, folds | `src/core/components/SourceCodeView.tsx` |
| Markdown rendering and styles | `src/core/terminalMarkdown/render.ts` and `syntaxHighlight.ts` |
| Canvas viewport | `src/core/diagramCanvas.ts` |
| Character-cell selection | `src/core/components/AsciiSelectionGrid.tsx` |
| Diff states | `src/core/components/DiagramPartialDiffOverlay.tsx` |
| Mapping pane, connectors, selection states | `src/mapping/components/DisplayPane.tsx` and `SelectionEffectsLayer.tsx` |
| Mapping navigation / explorer | `src/mapping/components/MappingSubmenu.tsx` and `MappingDiagramExplorer.tsx` |
| Chat and verbosity | `src/mapping/components/LocalChatConvo.tsx` and `LocalChatVerbosityToggle.tsx` |
| Spatial layout | `src/mapping/projectedPaneLayout.ts` and `conversationPaneLayout.ts` |

These source files are unmodified reference copies. They retain imports from the app and are not a standalone build. The preview uses self-contained HTML specimens and actual CSS; it does not simulate the product's canvas, persistence, or backend.

## Asset provenance

- `assets/palette.svg` is generated from the eleven product root color variables.
- `assets/brand/nd-mark.svg` is a convenience SVG reconstruction of `.brand-mark`, not an original logo file. The original mark is HTML text styled by CSS.
- `assets/brand/projection-connector.svg` uses representative geometry from the path formula in `SelectionEffectsLayer.tsx` and its 1px cyan stroke from CSS. It is an example, not a fixed product connector size.
- `assets/themes/*.json` serializes the installed `@shikijs/themes` exports selected by the app. The installed package version is in the manifest; its license is included beside the files.
- Product fonts are system dependencies; no font binaries were present to copy. Product photos, illustrations, and an external icon set were not found in the app source.

## Updating this snapshot

Copy the current main CSS, variant CSS, and reference source to the same paths; extract the first `<style>` block from `render.ts` into `styles/terminal-markdown.css`. Regenerate the token files, palette, and declaration inventory from those sheets, preserving selectors and media conditions. Refresh syntax themes from the installed package with its license. Update the manifest's date, commit, and hashes. Recheck the preview and revise guidance when component rules change. Do not edit snapshot CSS and assume it changes the live application.
