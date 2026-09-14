Read the complete source snapshot supplied in the request and generate a compacted ascii representation of the code

Note that the compacted file need not follow the order of the file exactly
This allows you to present logical groupings more coherently than strictly obeying their order in the source file

Write your output to:  ~/code/vscode/diagram.txt

Here is an example of the compaction style/level of detail that you should aim for

\-- Create rendering surfaces
    |
    +-- DOM surfaces
    |   |
    |   +-- new div -> createFastDomNode() -> _linesContent
    |   |   // Wraps the element; caches setters to skip redundant writes.
    |   |   +-- 'lines-content monaco-editor-background' -> className
    |   |   +-- 'absolute' -> position
    |   |   \-- reference later passed to:
    |   |       +-- EditorScrollbar
    |   |       \-- ViewLines
    |   |
    |   \-- new div -> createFastDomNode() -> domNode
    |       +-- _getEditorClassName() -> className
    |       |   // Reads edit-context focus, not broader widget focus.
    |       |   +-- configuration.editorClassName
    |       |   +-- theme selector
    |       |   \-- edit-context focus
    |       +-- 'code' -> role
    |       \-- reference later passed to EditorScrollbar
    |
    \-- Text renderers
        |
        +-- Optional GPU context
        |   _context.configuration.options
        |       -> experimentalGpuAcceleration == 'on'?
        |           +-- yes:
        |           |   _context -> createInstance(ViewGpuContext)
        |           |       // Injects services; creates canvas.
        |           |       // Shared device acquisition is async.
        |           |       |
        |           |       v
        |           |   _viewGpuContext
        |           \-- no:
        |               _viewGpuContext remains undefined
        |
        +-- Scrollbar
        |   _context ------------------+
        |   _linesContent -------------+
        |   domNode -------------------+--> new EditorScrollbar()
        |   _overflowGuardContainer ---+        |
        |                                       v
        |                                   _scrollbar
        |   // Wraps linesContent; uses viewLayout scroll state.
        |   // Root handles wheel input; focus-induced native scrolls
        |   // transfer into editor state, then reset.
        |                                       |
        |                              _viewParts.push(_scrollbar)
        |                              // Registers for render passes.
        |
        +-- DOM text renderer
        |   _context ------------------+
        |   _viewGpuContext -----------+--> new ViewLines()
        |   _linesContent -------------+        |
        |                                       v
        |                                   _viewLines
        |   // Always created; owns visible-lines DOM.
        |   // Passes GPU context to individual lines.
        |
        \-- GPU text renderer
            _viewGpuContext exists?
                \-- yes:
                    _context ----------+
                    _viewGpuContext ---+--> createInstance(ViewLinesGpu)
                                                |
                                                v
                                            _viewLinesGpu
                    // Reuses canvas/device; initializes asynchronously.