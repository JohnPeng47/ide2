# Global Representation Input Routing

The global interceptor should live beside the pane system, not inside `FileExplorerPanel` or `App.tsx`. `PaneWorkspace` already knows the focused pane and active tab, so it is the natural routing boundary.

```text
window keydown
      │
      ▼
RepresentationInputRegistry
      │ resolves focused pane + active representation
      ▼
PaneFrame input scope
      │
      ├── File Explorer shortcuts
      ├── Diagram shortcuts
      └── Code Entity shortcuts
```

## Proposed architecture

### 1. Add a representation input registry

Create `src/panes/input.ts` containing a framework-independent class:

```ts
interface RepresentationShortcut {
  id: string;
  label: string;
  sequence: readonly string[];
  handler: () => boolean | void;
  allowInEditable?: boolean;
}

class RepresentationInputRegistry {
  register(scope, shortcuts): () => void;
  setActiveScope(scope): void;
  handleKeyDown(event: KeyboardEvent): void;
}
```

Responsibilities:

- Normalize combos such as `Ctrl+G`.
- Support multi-key sequences later.
- Route commands only to the focused pane’s active representation.
- Ignore editable elements unless explicitly allowed.
- Respect `event.defaultPrevented`, IME composition, and key repeats.
- Call `preventDefault()` only when a registered command accepts the input.
- Return an unregister function for component cleanup.

Resolution order should be:

```text
modal → focused representation → focused pane → workspace → application
```

### 2. Integrate it at `PaneWorkspace`

Mount one capture-phase `window.keydown` listener in [PaneWorkspace.tsx](/home/john/.herdr/worktrees/new-diagram/worktree-transcripts/src/panes/PaneWorkspace.tsx:239).

Each `PaneFrame` would wrap its active view in an input-scope provider containing:

```ts
{
  paneId: pane.id,
  representationId: activeTab.id,
  focused
}
```

Also add `onFocusCapture` to `PaneFrame`, so keyboard focus updates `focusedPaneId` even when focus did not originate from a pointer.

This keeps shortcut routing aligned with the existing `PaneApi` focus model.

### 3. Add a registration hook

Expose:

```ts
useRepresentationShortcuts([
  {
    id: "file-explorer.switch-view",
    label: "Switch file explorer view",
    sequence: ["Ctrl+G"],
    handler: openViewMenu
  }
]);
```

`FileExplorerPanel` registers its shortcut when mounted. Since only the active tab’s representation is rendered, hidden file-explorer tabs cannot accidentally handle the command.

I would treat `Ctrl+G` as a direct trigger initially. The registry can still represent it as a one-stroke sequence, allowing real chord prefixes later.

### 4. Add the file-explorer view switcher

Add local view state:

```ts
type FileExplorerView = "active-diagram" | "all-diagram-sets";
```

`Ctrl+G` opens a dropdown anchored in the explorer’s mode bar:

```text
FILE EXPLORER VIEW

● Active diagram
○ All diagram sets
```

Behavior:

- Always shows both views.
- Current view uses a checked radio-menu item.
- Arrow keys move between choices.
- Enter or Space selects.
- Escape closes and restores focus to the previously focused tree row.
- Clicking outside closes it.
- Add a visible mode-bar button so the feature is discoverable without knowing the shortcut.
- Keep the selection session-local initially; no persisted schema change.

The existing explorer remains the `active-diagram` renderer. The global renderer should be isolated behind the second mode rather than woven into the original tree implementation. I recommend using the right-aligned DiagramSet columns for that global view, avoiding the rejected `C|E|R` prefixes.

### 5. Avoid conflicting global listeners

There is already an application-level undo listener in [App.tsx](/home/john/.herdr/worktrees/new-diagram/worktree-transcripts/src/App.tsx:890), plus standalone Escape listeners in overlays.

For this change:

- Leave modal Escape/focus-trap listeners alone initially.
- Register `Ctrl+G` only through the new registry.
- Have the registry exit when an earlier handler has already prevented the event.
- Later migrate workspace undo/redo into workspace-scoped registrations.
- Migrate modal listeners only after the registry has explicit modal priority.

### 6. Verification

Add tests for:

- Combo normalization and cleanup.
- Only the focused representation receiving a shortcut.
- Hidden/inactive tabs not receiving it.
- Editable fields suppressing `Ctrl+G`.
- Dropdown always containing exactly two views.
- Keyboard selection and Escape focus restoration.
- Switching views without losing the active diagram or expanded-tree state.
- Browser test: focus file explorer → press `Ctrl+G` → select global → focus another pane → confirm `Ctrl+G` no longer opens the explorer menu.

This establishes the shared input architecture first, then makes the file explorer its first registered representation.