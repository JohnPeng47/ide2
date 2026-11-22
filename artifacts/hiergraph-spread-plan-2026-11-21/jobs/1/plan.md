# Compression

## Vertical
- `Session IO and emulation: io, io_thread, io_thr`: combines persistent emulator state, the writer event loop, and backend execution state. POSIX output additionally uses separate gather and parser workers with a bounded buffer pipeline; Windows retains a serial reader. Sources: `src/termio/Termio.zig`, `src/termio/Thread.zig`, `src/termio/Exec.zig`.
- `terminal: terminal.Terminal -- authoritative emulator state`: hides screen allocation and generations, page storage, tracked pins, viewport state, and resident/compressed scrollback. The alternate screen is initialized on demand, not necessarily present. Sources: `src/terminal/Terminal.zig`, `src/terminal/ScreenSet.zig`, `src/terminal/Screen.zig`, `src/terminal/PageList.zig`.
- `Presentation: renderer, renderer_state, renderer_thread, renderer_thr`: merges three different structures: shared-access state, renderer-owned snapshots/GPU resources, and scheduling machinery. The renderer also has a separate draw mutex, optional display link, exported-frame state, and display-realization lifecycle. Sources: `src/renderer/State.zig`, `src/renderer/generic.zig`, `src/renderer/Thread.zig`.
- `User interaction and terminal actions (src/Surface.zig)`: hides the distinction between retained keyboard/mouse state, callback operations, and configuration-owned bindings referenced by key sequences and tables. Sources: `src/Surface.zig`.
- `Search: optional Surface.Search (src/Surface.zig)`: compresses worker management, per-screen searchers, active-viewport searching, generation tracking, and copied result payloads. Sources: `src/Surface.zig`, `src/terminal/search/Thread.zig`, `src/terminal/search/terminal.zig`.
- `app, rt_app, rt_surface -- references, not owned application objects`: places external application responsibilities inside the Surface narrative. App owns its registry, mailbox, shared font set, and render device; registry entries are runtime-surface pointers, not owned core sessions. Sources: `src/App.zig`, `src/apprt.zig`, `src/font/SharedGridSet.zig`.

## Horizontal
- `surfaceMailbox(), handleMessage() (src/Surface.zig; src/apprt/surface.zig)`: the apparent surface mailbox is an addressing adapter over App’s queue. App checks that the destination remains registered before dispatching. Sources: `src/apprt/surface.zig`, `src/App.zig`.
- `Lifecycle implementation: init(), deinit(), needsConfirmQuit(), close()`: hides the distinction between requesting host closure and stopping workers, including backend reader shutdown and renderer/display-link teardown ordering. Sources: `src/Surface.zig`, `src/termio/Exec.zig`, `src/renderer/generic.zig`.
- `Configuration, font selection and geometry (src/Surface.zig)`: compresses configuration fan-out, binding-pointer invalidation, asynchronous font-reference handoff, and two resize notifications to the renderer: directly from Surface and subsequently from Termio. Sources: `src/Surface.zig`, `src/termio/Termio.zig`, `src/renderer/Thread.zig`.
- `queueIo() -- common outgoing-message gate`: terminal modes feed input encoding, while readonly filters Surface write requests. Protocol replies generated inside Termio use another route and do not pass through this gate. Sources: `src/Surface.zig`, `src/termio/stream_handler.zig`, `src/termio/Termio.zig`.
- `renderer_state: renderer.State (src/renderer/State.zig)`: its terminal and inspector fields are references, not containment. Demand locking also connects snapshot acquisition to reader-side yielding between output batches. Sources: `src/renderer/State.zig`, `src/renderer/generic.zig`, `src/termio/Exec.zig`.
- `Search: optional Surface.Search (src/Surface.zig)`: results fork into renderer highlights and main-thread UI counts; copied highlights can become stale and require validation. Sources: `src/Surface.zig`, `src/renderer/generic.zig`, `src/terminal/search/terminal.zig`.
- `Inspector: optional owned Inspector (src/inspector/Inspector.zig)`: activation changes shared references and worker behavior; inspector presence switches output parsing to bytewise interleaving. Sources: `src/Surface.zig`, `src/termio/Termio.zig`, `src/inspector/Inspector.zig`.

# Canvases

## Session · current

Keep the input as the navigation overview. Add focused views for Surface-level state and cross-component coordination; move substantial IO and presentation internals below their respective anchors.

Diagram views reuse node identities. A repeated endpoint is not a second component. T denotes composition, not execution order; borrowed pointers, calls, notifications, and ownership transfers use E. The input’s responsibility headings remain logical groupings, not invented Zig objects.

### Diagrams
- **core · Verified session overview**: vertical; anchored to the supplied input → `Ghostty terminal-session core -- Surface (src/Surface.zig)`. Retain the input diagram, distinguish owned members from external references, and replace expanded internals with links to their detailed views. Sources: `src/Surface.zig`, `src/App.zig`.
- **control · Main-thread dispatch and lifetime**: horizontal; anchored to Session/core → `Surface control and runtime boundary`. Trace addressed messages through App dispatch, runtime actions, close requests, and destruction. Show search → renderer → IO stop/join ordering, backend reader shutdown, and renderer destruction before renderer-thread resources. Do not expand mailbox or worker internals here. Sources: `src/Surface.zig`, `src/App.zig`, `src/apprt/surface.zig`, `src/termio/Exec.zig`.
- **interaction · Input state and action boundaries**: vertical; anchored to Session/core → `User interaction and terminal actions (src/Surface.zig)`. Expand keyboard sequence state, queued writes, active tables, pressed-key tracking, and mouse gesture/button/scroll/link state. Expose callback ports for bindings, key/mouse encoding, IME, selection, and clipboard permission/completion. Keep encoders as called services, not owned state. Sources: `src/Surface.zig`, `src/input/key_encode.zig`, `src/input/mouse_encode.zig`, `src/input/paste.zig`.
- **reconfigure · Configuration, fonts, and resize propagation**: horizontal; anchored to Session/core → `Configuration, font selection and geometry (src/Surface.zig)`. Trace conditional configuration derivation, sequence/table reset, worker configuration messages, font-grid acquisition and handoff, metric-driven sizing, and resize propagation. Distinguish immediate renderer geometry updates from coalesced IO resize and its subsequent renderer notification. Sources: `src/Surface.zig`, `src/termio/Thread.zig`, `src/termio/Termio.zig`, `src/renderer/Thread.zig`.
- **search · Search ownership and result destinations**: vertical; anchored to Session/core → `Search: optional Surface.Search (src/Surface.zig)`. Expand worker state/handle, mailbox, refresh timer, optional TerminalSearch, per-live-screen ScreenSearch instances, viewport search, generation tracking, and result caches. Show locked feeding versus search-owned processing; reference, rather than reproduce, terminal storage. Sources: `src/Surface.zig`, `src/terminal/search/Thread.zig`, `src/terminal/search/terminal.zig`, `src/terminal/search/screen.zig`, `src/terminal/search/viewport.zig`.
- **inspection · Optional observation hooks**: horizontal; anchored to Session/core → `Inspector: optional owned Inspector (src/inspector/Inspector.zig)`. Trace activation/deactivation, shared inspector-reference publication, worker notifications, key-event recording, and bytewise PTY observation. Retain the input’s small inspector composition rather than creating another subsystem canvas. Sources: `src/Surface.zig`, `src/inspector/Inspector.zig`, `src/termio/Termio.zig`.

### Links
- `Session/core → User interaction and terminal actions` → `Session/interaction → Keyboard` · T · retained sequence, queue, and table-stack state.
- `Session/core → User interaction and terminal actions` → `Session/interaction → Mouse` · T · retained gesture, button, scroll, and link state.
- `Session/interaction → Keyboard` → `Session/core → config: DerivedConfig; config_conditional_state: ConditionalState` · E · sequence/table pointers reference configuration-owned bindings.
- `Session/interaction → input encoders` → `IO/emulator → Terminal` · E · read terminal modes to choose emitted bytes.
- `Session/interaction → outgoing input` → `IO/transport → Termio.mailbox` · E · queueIo transfers messages; readonly drops Surface write requests.
- `Session/interaction → preeditCallback()` → `Presentation/resources → renderer.State.preedit` · E · replace composition text under the shared lock.
- `Session/interaction → clipboard operations` → `Services/boundary → runtime services` · E · request clipboard access, confirmation, and completion.
- `IO/protocol → surface messages` → `Services/boundary → App.mailbox` · E · enqueue addressed UI/protocol notifications.
- `Services/boundary → App dispatch` → `Session/control → handleMessage()` · E · deliver only while the destination remains registered.
- `Session/control → close()` → `Services/boundary → rt_surface.close()` · E · request host-controlled closure with confirmation policy.
- `Session/control → deinit()` → `Session/search → worker` · E · stop and join before shared state release.
- `Session/control → deinit()` → `Presentation/scheduling → renderer worker` · E · stop and join before renderer destruction.
- `Session/control → deinit()` → `IO/transport → IO worker` · E · stop and join; backend shutdown also joins its reader.
- `Session/reconfigure → updateConfig()` → `Session/interaction → sequence/table state` · E · discard references invalidated by configuration replacement.
- `Session/reconfigure → setFontSize()` → `Services/fonts → SharedGridSet` · E · acquire a matching grid reference.
- `Session/reconfigure → font-grid message` → `Presentation/scheduling → renderer mailbox` · E · transfer new-grid acceptance and old-key release responsibility.
- `Session/reconfigure → resize()` → `IO/transport → resize coalescer` · E · submit terminal/PTY geometry.
- `Session/reconfigure → resize()` → `Presentation/scheduling → renderer mailbox` · E · independently submit current screen and padding geometry.
- `Session/core → Search: optional Surface.Search (src/Surface.zig)` → `Session/search → worker state and handle` · T · optional Surface-owned search execution.
- `Session/search → worker state` → `Session/search → TerminalSearch` · T · optional search engine with screen and viewport searchers.
- `Session/search → TerminalSearch` → `IO/emulator → Terminal` · E · feed under shared locking and reconcile screen generations.
- `Session/search → searchCallback_()` → `Presentation/resources → search highlights` · E · transfer cloned highlight payloads through the renderer mailbox.
- `Session/search → searchCallback_()` → `Services/boundary → App.mailbox` · E · send match totals and selected index to the main thread.
- `Session/inspection → activate/deactivate` → `Presentation/resources → renderer.State.inspector` · E · publish or clear a borrowed reference under lock.
- `Session/interaction → key events` → `Session/inspection → Inspector` · E · record events and encoded bytes.
- `IO/protocol → processOutput()` → `Session/inspection → Inspector` · E · interleave recording and parsing byte by byte while attached.

## IO · child of Session/core → `Session IO and emulation: io, io_thread, io_thr`

Separate execution machinery, protocol interpretation, and authoritative emulator storage. These are direct constituents of the input’s session-IO grouping, but are not all fields owned by Termio.

### Diagrams
- **transport · Backend and worker topology**: vertical; anchored to Session/core → `Session IO and emulation: io, io_thread, io_thr`. Distinguish Termio’s owned backend/mailbox from the sibling IO-thread manager and handle. Expand Exec.Subprocess and runtime ThreadData: write queue/pool, process watcher, termios timer, and reader handle. Show the POSIX gather/parser pipeline, ring-buffer ownership, backpressure, and shutdown; mark the Windows serial alternative. Sources: `src/Surface.zig`, `src/termio/Termio.zig`, `src/termio/Thread.zig`, `src/termio/Exec.zig`.
- **protocol · Output parsing and protocol side effects**: horizontal; anchored to Session/core → `terminal_stream: StreamHandler.Stream (src/termio/stream_handler.zig)`. Trace processOutput through stream parsing and StreamHandler dispatch into terminal mutation, replies, UI messages, and render wakeups. Expose APC/DCS and clipboard transaction/grant state only where needed to explain dispatch; include the optional tmux-viewer branch without expanding that subsystem. Sources: `src/termio/Termio.zig`, `src/termio/stream_handler.zig`.
- **emulator · Screens and page-backed state**: vertical; anchored to Session/core → `terminal: terminal.Terminal -- authoritative emulator state`. Expand global modes/colors/title/directory/tabstops, ScreenSet, primary and optional alternate screens, and each Screen’s cursor, selection, charset, Kitty state, and PageList. Expand PageList into page nodes, resident/compressed storage, viewport, tracked pins, and compression bookkeeping. Sources: `src/terminal/Terminal.zig`, `src/terminal/ScreenSet.zig`, `src/terminal/Screen.zig`, `src/terminal/PageList.zig`.

### Links
- `Session/core → Session IO and emulation: io, io_thread, io_thr` → `IO/transport → Termio` · T · session-owned IO implementation.
- `Session/core → Session IO and emulation: io, io_thread, io_thr` → `IO/transport → IO-thread manager and handle` · T · sibling execution machinery, not a Termio field.
- `IO/transport → Termio` → `IO/transport → Exec backend` · T · Surface selects and initializes the exec backend.
- `IO/transport → Termio` → `IO/protocol → terminal_stream` · T · owns parser and handler state.
- `IO/transport → Termio` → `IO/emulator → Terminal` · T · owns authoritative emulator state.
- `IO/transport → gather worker` → `IO/transport → parser worker` · E · publish bounded batches; consumed slots permit further gathering.
- `IO/transport → parser worker` → `IO/protocol → processOutput()` · E · parse each batch while holding the shared terminal mutex.
- `IO/protocol → StreamHandler` → `IO/emulator → Terminal` · E · apply decoded terminal operations.
- `IO/protocol → StreamHandler` → `IO/transport → Termio.mailbox` · E · enqueue protocol replies independently of Surface.queueIo.
- `IO/transport → IO-thread dispatch` → `IO/transport → Exec write queue` · E · perform backend writes from the writer side.
- `IO/emulator → Terminal` → `IO/emulator → ScreenSet` · T · owns initialized screens and generation metadata.
- `IO/emulator → ScreenSet` → `IO/emulator → initialized Screen instances` · T · primary plus alternate when allocated.
- `IO/emulator → Screen` → `IO/emulator → PageList` · T · owns grid/scrollback storage and viewport bookkeeping.
- `IO/transport → Termio.resize()` → `IO/emulator → Terminal.resize()` · E · resize PTY and emulator under the same lock.
- `IO/transport → Termio.resize()` → `Presentation/scheduling → renderer mailbox` · E · notify after terminal resize.
- `IO/protocol → render wakeup` → `Presentation/scheduling → wakeup signal` · E · schedule frame-state refresh.
- `IO/transport → parser batch boundary` → `Presentation/resources → renderer.State demand coordination` · E · yield to waiting frame snapshots.
- `IO/transport → synchronized-output timer` → `IO/emulator → synchronized_output mode` · E · clear a stalled rendering pause.

## Presentation · child of Session/core → `Presentation: renderer, renderer_state, renderer_thread, renderer_thr`

Separate shared access, derived frame resources, and scheduling. The terminal, font grid, and application device remain external identities.

### Diagrams
- **resources · Shared state versus renderer-owned resources**: vertical; anchored to Session/core → `Presentation: renderer, renderer_state, renderer_thread, renderer_thr`. Decompose renderer.State into mutex/demand coordination, preedit, mouse state, and borrowed terminal/inspector references. Separately decompose GenericRenderer into RenderState snapshot, shaper/cache, cells/images/highlights, draw mutex, graphics API, swap chain/frame resources, shaders, optional display link, and latest exported frame. Sources: `src/renderer/State.zig`, `src/renderer/generic.zig`, `src/renderer/Metal.zig`, `src/renderer/OpenGL.zig`.
- **scheduling · Refresh, drawing, and maintenance**: horizontal; anchored to Session/core → `renderer_thread: renderer.Thread; renderer_thr: worker handle`. Trace mailbox draining, wakeup/updateFrame, blink/animation timers, visibility gating, vsync/display-link drawing, synchronous host draws, and display realization. Show compression as maintenance scheduled here but implemented by terminal storage. Sources: `src/renderer/Thread.zig`, `src/renderer/generic.zig`, `src/Surface.zig`.

### Links
- `Session/core → Presentation: renderer, renderer_state, renderer_thread, renderer_thr` → `Presentation/resources → renderer.State` · T · Surface-owned shared-access structure.
- `Session/core → Presentation: renderer, renderer_state, renderer_thread, renderer_thr` → `Presentation/resources → GenericRenderer` · T · per-surface rendering implementation.
- `Session/core → Presentation: renderer, renderer_state, renderer_thread, renderer_thr` → `Presentation/scheduling → renderer-thread manager and handle` · T · Surface-owned scheduling machinery.
- `Presentation/resources → renderer.State` → `IO/emulator → Terminal` · E · borrowed pointer; no duplicate terminal ownership.
- `Presentation/resources → GenericRenderer` → `Presentation/resources → RenderState snapshot` · T · renderer-owned derived state, distinct from Terminal.
- `Presentation/scheduling → updateFrame()` → `Presentation/resources → renderer.State` · E · demand-lock and snapshot shared state.
- `Presentation/resources → GenericRenderer` → `Services/fonts → SharedGrid` · E · resolve/rasterize glyphs and synchronize atlas contents.
- `Presentation/resources → graphics API` → `Services/boundary → App.device` · E · borrow the shared application device.
- `Presentation/scheduling → font-grid acceptance` → `Services/fonts → SharedGridSet.deref()` · E · release the old reference after installing the new grid.
- `Presentation/scheduling → draw trigger` → `Presentation/resources → drawFrame()` · E · draw according to visibility and pacing; not every refresh immediately draws.
- `Session/control → Surface.draw()` → `Presentation/resources → drawFrame(true)` · E · host-driven synchronous drawing.
- `Presentation/scheduling → compression timer` → `IO/emulator → Terminal/PageList compression` · E · request incremental maintenance under shared locking.
- `Presentation/resources → scrollbar/frame notifications` → `Services/boundary → runtime boundary` · E · publish UI changes or frames for host presentation.

## Services · same level as Session

Application-wide resources and runtime services are dependencies of a session, not Surface parts. Connecting E relations are Surface → App dispatch, Surface → runtime actions/clipboard/closure, Surface → shared font acquisition, and renderer → shared font grid/device.

### Diagrams
- **boundary · App-owned services and runtime ports**: vertical; anchored to Session/core → `app, rt_app, rt_surface -- references, not owned application objects`. Expand App’s surface registry, mailbox, shared-font-set reference point, and optional shared device. Keep runtime App and Surface as separate boundary nodes selected through apprt; expose actions, callbacks, clipboard, closure, and presentation ports without expanding native window layouts. Sources: `src/App.zig`, `src/apprt.zig`, `src/apprt/surface.zig`, `src/Surface.zig`.
- **fonts · Shared font storage**: vertical; anchored to Session/core → `font_grid_key, font_size, font_metrics, font_size_adjusted`. Follow the external font-set reference to its actual owner, then decompose SharedGridSet into library/discovery services and keyed reference-counted grids. Decompose each grid into resolver, metrics, codepoint/glyph caches, lock, and grayscale/color atlases. Leave per-renderer shaping and GPU atlas copies on Presentation. Sources: `src/font/SharedGridSet.zig`, `src/font/SharedGrid.zig`, `src/App.zig`.

### Links
- `Services/boundary → App` → `Services/boundary → surface registry` · T · owns the collection of runtime-surface pointers.
- `Services/boundary → surface registry` → `Session/core → Surface` · E · tracks sessions through runtime-surface entries; removal does not destroy them.
- `Services/boundary → App` → `Services/boundary → App.mailbox` · T · owns the main-thread queue.
- `Services/boundary → App` → `Services/boundary → App.device` · T · owns the lazily initialized shared device.
- `Services/boundary → App` → `Services/fonts → SharedGridSet` · T · owns application-wide font storage.
- `Services/fonts → SharedGridSet` → `Services/fonts → SharedGrid` · T · owns keyed grids until their reference counts reach zero.
- `Services/fonts → SharedGrid` → `Services/fonts → resolver, caches, metrics, and atlases` · T · shared CPU-side font resources.
- `Session/core → font_grid_key, font_size, font_metrics, font_size_adjusted` → `Services/fonts → SharedGrid` · E · retains a grid reference, not grid storage.
- `Services/boundary → runtime callbacks` → `Session/interaction → callback ports` · E · deliver input and clipboard completion.
- `Services/boundary → runtime size/scale callbacks` → `Session/reconfigure → geometry callbacks` · E · supply display geometry.
- `Session/control → final teardown` → `Services/fonts → SharedGridSet.deref()` · E · release the session’s remaining font reference.

# Summary

The plan uses four canvases: the current session view, IO and presentation children, and an application-services peer. Vertical expansion concentrates on genuinely rich owned structures; horizontal views explain coordination without duplicating those structures.

The input is broadly accurate, with these corrections and qualifications:

- POSIX PTY reading includes a separate gather worker and bounded pipeline.
- Readonly filters Surface-originated writes, not every protocol reply.
- The alternate screen is optional and generation-tracked.
- App’s registry tracks runtime surfaces; unregistering does not destroy them.
- Font replacement releases the old reference on renderer-thread acceptance.
- Refresh, drawing, visibility, and vsync are distinct scheduling paths.
- Inspector attachment itself selects bytewise output parsing.

Verified against commit `ea8b12a8a9894b5259c441eadd8f6f0c65e215af`; the checkout remained unchanged.
