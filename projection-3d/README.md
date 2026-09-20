# 3D diagram projections

A standalone viewer for the original VS Code D2 and D5 diagrams. It shares the
mapping canvas's palette, 24px grid, compact controls, and 13px/1.4 monospace text.
All application files live in this folder. No runtime dependencies or external
services are needed; build commands use the repository's existing Vite install.

## Run

From the repository root (after its usual `npm install`):

```sh
npm --prefix projection-3d run dev
```

Open **http://127.0.0.1:5193**.

```sh
npm --prefix projection-3d run build
npm --prefix projection-3d run test
npm --prefix projection-3d run check:browser
```

`npm --prefix projection-3d run preview` serves `dist/` on port 5194. The browser
check builds on the repository's local front-end CDP harness, launches a temporary
production server on an available port, and closes both server and browser.

## Use

- Drag to orbit; Shift-drag, middle-drag, or right-drag to pan.
- Scroll to zoom toward the pointer. Fit centers the visible planes.
- Use the layer separation and opacity sliders to inspect depth and overlap.
- Hover a component, endpoint, or edge to trace its correspondences. Click to pin.
- Checkboxes hide individual component edges. Clear selection unpins the current group.
- D2 and D5 reading views show one diagram face-on; dragging pans in these views.
- Focus the canvas: arrow keys orbit, Shift-arrow keys pan, `+`/`-` zoom,
  `F` fits, and Escape clears selection. All sidebar controls support the keyboard.
- Reset restores the initial oblique camera, separation, opacity, and all six edges.

## Saved visualizations

The **Visualizations** panel provides **Save copy**, **Load**, **Export JSON**, and
**Import JSON**. Named copies persist in this browser. Export a JSON file for a
portable copy; importing validates the entire file, saves a new copy, and loads
it. The current view also restores after a reload. Hover and active gestures are
transient and are not saved.

Two source-controlled snapshots are included:

- `visualizations/upright.json`: the original upright configuration.
- `visualizations/flat.json`: horizontal planes, D2 above D5, arrows directed down
  to D5. Choose it in the saved list and press **Load**, or open
  `http://127.0.0.1:5193/?visualization=flat`.

A visualization uses `format: "projection-3d"`, `version: 1`, and contains its ID,
name, complete D2/D5 ASCII sources with their provenance, camera angles, plane
orientation/separation/opacity, reading mode, zoom, pan, enabled component IDs,
and pinned component. A saved viewport size lets the viewer adapt zoom/pan
proportionally to another window. Loading at the same viewport reproduces the
saved camera. This version supports the viewer's D2/D5 correspondence dialect;
it does not import arbitrary diagram graphs. Invalid files leave the scene intact.

The orientation selector can switch any view between upright and flat. Flat
planes occupy XZ with D2 at `Y = separation` and D5 at `Y = 0`. Reading views face
the selected plane directly. Orbit and tilt controls apply in the combined view.

## Geometry and data

`diagrams.json` is an exact snapshot of the original saved ASCII strings, with
source representation and revision IDs. It never reads or writes live project data.
`geometry.mjs` locates primary component names at their original row/column spans.
Incidental mentions inside methods and prose are not additional correspondence nodes.
TextModel has one node in D2 and two nodes in D5, producing six edges across five
shared components. The original layouts are not rearranged.

In upright mode, both diagrams occupy XY planes: D2 at Z=0 and D5 at the adjustable separation.
An orthonormal camera basis projects 3D coordinates onto SVG. The resulting affine
matrix renders each plane's text and highlights; the same projection calculates
the correspondence endpoints. This is an orthographic 3D projection, with no
perspective scaling, raster textures, or WebGL requirement.

Planes share a center in XY. A plane's upper-left local coordinates retain the
original ASCII character grid. Character advance is measured from the actual
monospace font; SVG rows have explicit text lengths to maintain that grid.

Edge segments are split at projected plane boundaries and depth-tested against
their surfaces. Portions behind a plane are dashed. Endpoint dots stay visible
as overlays so hidden labels can still be located. Plane opacity affects the
background surface; text remains legible. Large diagrams are small at fit-to-view;
zoom in or use either reading view for full-size text.

Style reference: `src/app/styles/globals.css`, especially `:root`,
`.mapping-poc-canvas`, `.mapping-poc-ascii`, and `.mapping-grid-tools`.

## Ink & paper: one box per D5 node

Open **http://127.0.0.1:5193/boxes.html**, use the **Ink & Paper · Node Boxes**
link in the plane viewer, or load **D5 — ink & paper** from its saved list.

D5 is the sparser source (1,054 alphanumeric characters versus D2's 1,640).
`visualizations/d5-boxes.json` contains its complete original ASCII, **56 separate
source-label occurrences**, explicit box geometry, and **60 connections**.
Labels are drawn on each box's top using the same oblique transform as the box.
Service nodes have taller sides, document nodes use stacked layers, and all
surfaces use the pale paper and ink palette with hatched sides.

The mapping is a source-specific transcription in `create-box-scene.mjs`.
Every node includes a one-based source line and inclusive column range. Route
labels (`resource groups`, `Stage`, `Open Changes`, `git:`, `file:`), the heading,
and the two legend lines remain annotations rather than additional boxes.
The coverage test accounts for every alphanumeric source character, checks that
no node occurrence is duplicated, and checks that box footprints do not overlap.
Regenerate the shipped scene with `node projection-3d/create-box-scene.mjs`.

- Drag to pan; Shift-drag to orbit; scroll or use +/− to zoom.
- Click a box to inspect its source and connected nodes. Double-click or press
  **Focus this box** to zoom to it. Chapter buttons frame subsets of the same scene.
- Keyboard: arrows pan, Shift-arrows orbit, +/− zoom, F fits, Escape clears selection.
- **Saved views** saves named copies locally and imports/exports portable JSON.
  The current camera and selection restore on reload.

Box files use `format: "projection-3d"`, `version: 2`, `kind: "node-boxes"`.
They include source, nodes, edges, floor headings, annotations, camera, and view
state. The plane viewer accepts them and opens the box renderer. Version-1 plane
files retain their existing format and behavior.

`npm --prefix projection-3d run check:browser` checks both renderers in disposable
headless browsers. `check:boxes` runs only the box interactions and persistence
checks. Build before running either browser command.
