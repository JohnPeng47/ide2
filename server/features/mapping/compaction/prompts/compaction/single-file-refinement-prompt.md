Read the accepted first-pass ASCII and mappings supplied in the request, then read the complete source snapshot to check meaning.

Render the first pass more sparsely using branching + light pseudocode and comments.

Submission:
- Call submit_file_compaction with the same `{ "ascii": "...", "mappings": [...] }` schema as the first pass.
- Keep the source-file root and its whole-file mapping. Update mappings for the new output lines, mapping each semantic row to supporting source ranges within its original block. Omit blank and connector-only rows.
- Verify mapping coverage and bounds, preserved content order, and behavioral accuracy against the same source snapshot.
- Do not modify files or spawn agents. The server preserves the first pass, computes hashes, and writes this pass to separate ASCII and mapping files.
- If the tool rejects the submission, correct its reported issues and submit again.

Style example: dense prose becomes branches and pseudocode. Follow its density; preserve your input's order even where this example regroups content.

Bad:
```text
View.constructor: assemble in this order
+-- 1. Establish focus, model context and input
|   +-- Widget-focus changes --> viewModel.setHasWidgetFocus()
|   +-- Initial selection = (1,1); pending render = null
|   +-- Create overflow guard, ViewController and ViewContext
|   +-- Register View before other event handlers so layout updates first
|   +-- Instantiate edit context --> connect clipboard events --> add to _viewParts
|   \-- Create lines surface and root DOM; root gets role='code'
|
+-- 2. Create text renderers and visual parts
|   +-- experimentalGpuAcceleration == 'on' --> create ViewGpuContext
|   +-- Create scrollbar and DOM ViewLines; GPU context also creates ViewLinesGpu
|   +-- Add view zones and decorations overview ruler
|   +-- Content overlays draw current line, selection, guides, decorations and whitespace
|   +-- Margin overlays draw highlights and line decorations/numbers; GPU adds GpuMarkOverlay
|   +-- Margin owns zone margin DOM, margin overlays and glyph widgets
|   +-- Content widgets, cursors and overlay widgets join _viewParts
|   \-- Choose GPU or DOM rulers; add block decorations and minimap
|
\-- 3. Attach visual layers and finish input wiring
    +-- Insert overview ruler at the scrollbar's requested location
    +-- Lines surface: content overlays --> optional DOM rulers --> zones --> text --> widgets --> cursors
    +-- Overflow guard receives margin, scrollbar, optional GPU canvas and remaining visual layers
    +-- Overflow widget host supplied?
    |   +-- yes --> attach overflowing content and overlay widgets to that host
    |   \-- no --> attach both to the editor root
    \-- _applyLayout() --> register PointerHandler with _createPointerHandlerHelper()
```

Good:
```text
View.constructor
  |
  +-- 1. Establish context and input
  |   |
  |   +-- register widget-focus tracker
  |   |   \-- on change:
  |   |       viewModel.setHasWidgetFocus(tracker.hasFocus())
  |   |
  |   +-- initialize state
  |   |   _selections = [Selection(1, 1, 1, 1)]
  |   |   _renderAnimationFrame = null
  |   |
  |   +-- create overflow guard
  |   +-- create ViewController
  |   +-- create ViewContext
  |   |   \-- register this View first
  |   |       // layout updates before other handlers
  |   |
  |   \-- prepare edit context
  |       _editContext = _instantiateEditContext()
  |       _connectEditContextClipboardEvents()
  |       _viewParts.push(_editContext)
  |
  +-- 2. Create rendering surfaces
  |   |
  |   +-- create _linesContent
  |   |   \-- position = absolute
  |   |
  |   +-- create domNode
  |   |   \-- role = "code"
  |   |
  |   +-- if GPU acceleration enabled:
  |   |   _viewGpuContext = new ViewGpuContext
  |   |
  |   +-- create EditorScrollbar
  |   +-- create ViewLines
  |   |
  |   \-- if _viewGpuContext exists:
  |       create ViewLinesGpu
  |
  +-- 3. Build visual parts and attach their DOM
  |   |
  |   +-- register visual parts in _viewParts
  |   |   \-- rulers = GPU context ? RulersGpu : Rulers
  |   |
  |   +-- insert overview ruler at scrollbar's requested location
  |   |
  |   +-- _linesContent
  |   |   +-- content overlays
  |   |   +-- rulers DOM, if present
  |   |   +-- view zones
  |   |   +-- view lines
  |   |   +-- content widgets
  |   |   \-- cursors
  |   |
  |   +-- domNode
  |   |   \-- overflow guard
  |   |       +-- margin
  |   |       |   +-- zone margins
  |   |       |   +-- margin overlays
  |   |       |   \-- glyph widgets
  |   |       +-- scrollbar
  |   |       +-- GPU canvas, if present
  |   |       +-- scroll decoration
  |   |       +-- overlay widgets
  |   |       +-- minimap
  |   |       \-- block decorations
  |   |
  |   \-- attach overflowing widgets
  |       host = overflowWidgetsDomNode ?? domNode
  |       host.append(overflowing content widgets)
  |       host.append(overflowing overlay widgets)
  |
  \-- 4. Finish
      _applyLayout()
      register PointerHandler(
          _context,
          _viewController,
          _createPointerHandlerHelper()
      )
```
