# Pane system

The pane layer is split into three pieces:

- `model.ts` is the immutable BSP layout engine. Pane leaves own their tabs;
  split nodes own orientation and ratio.
- `api.ts` exposes application commands and subscriptions without depending on
  React.
- `PaneWorkspace.tsx` recursively renders the tree, pane tab strips, content,
  and pointer/keyboard-accessible split dividers.

Create a root pane, then split any existing pane by placing a new pane on one
of its four sides:

```ts
const api = new PaneApi(createPaneLayout({
  id: "editor",
  tabs: [{ id: "file-a", label: "File A" }]
}));

api.createPane({
  id: "inspector",
  tabs: [{ id: "outline", label: "Outline" }]
}, "editor", { placement: "right", ratio: 0.7 });
```

Features can call `createPane`, `closePane`, `focusPane`, `resizeSplit`,
`activateTab`, `setTabs`, `addTab`, `moveTab`, and `closeTab`. Components below
`PaneWorkspace` can obtain the same command surface with `usePaneApi()`.
