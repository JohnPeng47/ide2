# Merged spread plan · Ghostty core

Synthesised from the five Astra/high spread plans (samples 1–5). Each section notes which samples it draws on. The plan has 7 canvases and 21 diagrams: 10 vertical and 11 horizontal. Cross-canvas links are listed once, under the canvas that holds their source endpoint.

Conventions used throughout:
- `Canvas/diagram → node` names a node inside a diagram. A repeated name refers to one node identity; it never creates a second owned copy.
- **T** is direct composition (whole → part). Borrowed pointers, calls, notifications, data flow, locking, scheduling and ownership transfer are **E**.
- The input's responsibility headings are logical groupings of Surface fields, not invented Zig objects.

# Compression

## Vertical
- `Session IO and emulation: io, io_thread, io_thr`: merges three different structures: Termio-owned state, the sibling IO thread/handle, and backend thread-local resources. POSIX output uses separate gather and parser workers with a bounded buffer pipeline; Windows keeps a serial reader. Sources: `src/Surface.zig`, `src/termio/Termio.zig`, `src/termio/Thread.zig`, `src/termio/Exec.zig`. (1–5)
- `terminal_stream: StreamHandler.Stream`: hides the parser/handler boundary and stateful APC, DCS and clipboard transactions, including session clipboard grants and build-gated tmux viewer state. Sources: `src/terminal/stream.zig`, `src/termio/stream_handler.zig`. (4, 3)
- `terminal: terminal.Terminal -- authoritative emulator state`: compresses Terminal → ScreenSet → Screen → PageList → Page. Cursor, selection, charset and Kitty state belong to Screen beside PageList, not inside it. The alternate screen is created lazily, and `ScreenSet.active` is an alias. Sources: `src/terminal/Terminal.zig`, `src/terminal/ScreenSet.zig`, `src/terminal/Screen.zig`, `src/terminal/PageList.zig`, `src/terminal/page.zig`. (1–5)
- `Presentation: renderer, renderer_state, renderer_thread, renderer_thr`: flattens four sibling Surface fields with different roles: shared-access state, renderer-owned snapshot/shaping/GPU resources (with a separate draw mutex and optional display link), and scheduling machinery. Sources: `src/renderer/State.zig`, `src/renderer/generic.zig`, `src/renderer/Thread.zig`. (1–5)
- `User interaction and terminal actions (src/Surface.zig)`: combines retained keyboard/mouse state, binding dispatch, protocol encoding and asynchronous clipboard transactions. Key tables borrow configuration-owned bindings; `pressed_key` and `last_binding_trigger` are Surface fields beside Keyboard. Sources: `src/Surface.zig`. (5, 1, 3)
- `Search: optional Surface.Search`: hides per-screen searchers, an independent viewport search, active/history results, screen generations and tracked selected matches. Sources: `src/terminal/search/Thread.zig`, `src/terminal/search/terminal.zig`, `src/terminal/search/screen.zig`. (4, 1, 2)
- `Inspector: optional owned Inspector`: keyboard history and VT recording sit beneath GUI state; the renderer-state inspector pointer is only a borrowed reference. Sources: `src/inspector/Inspector.zig`, `src/Surface.zig`. (5, 4)
- `app, rt_app, rt_surface -- references, not owned application objects` and `font_grid_key, font_size, font_metrics, font_size_adjusted`: point at App-owned structures (surface registry, mailbox, render device, `SharedGridSet` → reference-counted `SharedGrid`s) that deserve their own identities outside Surface. Sources: `src/App.zig`, `src/font/SharedGridSet.zig`, `src/font/SharedGrid.zig`. (4, 5)

## Horizontal
- `surfaceMailbox(), handleMessage()`: surface mailboxes are addressing wrappers over App's queue. Posting wakes the runtime; dispatch checks that the target surface is still registered. Sources: `src/apprt/surface.zig`, `src/App.zig`. (1–5)
- `Lifecycle implementation: init(), deinit(), needsConfirmQuit(), close()`: close is a host-mediated request, separate from destruction. Teardown stops/joins search → renderer → IO, destroys the renderer before renderer-thread state (display-link callbacks reference `draw_now`), then releases the final grid reference. Sources: `src/Surface.zig`, `src/termio/Exec.zig`, `src/apprt/embedded.zig`. (4, 5, 3)
- `Configuration, font selection and geometry`: reload invalidates borrowed binding references; font replacement hands retirement of the old grid to the renderer thread; resize reaches the renderer twice: directly, and again after Termio's locked PTY/terminal resize. Sources: `src/Surface.zig`, `src/renderer/Thread.zig`, `src/termio/Termio.zig`. (1–5)
- `queueIo() -- common outgoing-message gate`: readonly filters Surface-originated writes only; StreamHandler replies enter the IO mailbox directly. Ownership transfer and queue-full backpressure (shared mutex released and reacquired) are hidden. Sources: `src/Surface.zig`, `src/termio/mailbox.zig`, `src/termio/stream_handler.zig`. (1–5)
- `Text, IME and clipboard operations`: mixes display-only preedit, ordinary paste, OSC 52 and Kitty clipboard permission/response cycles. OSC 52 writes do not pass through `startClipboardRequest()`. Sources: `src/Surface.zig`, `src/termio/stream_handler.zig`. (5, 4)
- `renderer_state: renderer.State`: the shared mutex connects parsing, input, snapshots, search and inspection; demand/handoff counters keep busy POSIX parsing from starving snapshots. `updateFrame()` is not purely observational: it can scroll the viewport and advance Kitty animations. Sources: `src/renderer/State.zig`, `src/termio/Exec.zig`, `src/renderer/generic.zig`. (4, 5, 2)
- `renderer_thread: renderer.Thread; renderer_thr: worker handle`: wakeup → update → draw is conditional. Visibility, display realization, synchronized output and vsync gate different stages; host-driven `Surface.draw()` draws without a fresh snapshot; compression scheduling reaches back into terminal storage. Sources: `src/renderer/Thread.zig`, `src/renderer/generic.zig`. (1–5)
- `searchCallback_() -> renderer mailbox ...`: results split into cloned rendering highlights and main-thread UI counts; their page identities can become stale and must be validated. Sources: `src/Surface.zig`, `src/terminal/search/terminal.zig`, `src/renderer/generic.zig`. (4)

# Canvases

## Session · current

The root canvas. Keep the input as a corrected orientation index; detailed interiors move to child canvases and are reached through links from their anchor lines. (1–5)

### Diagrams
- **core · Surface ownership index**: vertical; anchored to the input root `Ghostty terminal-session core -- Surface (src/Surface.zig)`. Retain the input's responsibility groups as a collapsed index of Surface fields, apply the corrections in this plan, and mark owned members versus references (App, runtime, terminal, shared fonts). Each expanded branch becomes an entrance to its child canvas. Sources: `src/Surface.zig`.
- **lifecycle · Construction, close and teardown**: horizontal; anchored to Session/core → `Lifecycle implementation: init(), deinit(), needsConfirmQuit(), close()`. Construction before worker startup; host-mediated close with confirmation policy; search → renderer → IO stop/join; backend reader shutdown; renderer destruction before renderer-thread state; final grid/preedit/mutex cleanup. Sources: `src/Surface.zig`, `src/termio/Exec.zig`, `src/apprt/embedded.zig`. (4, 5, 3)
- **reconfigure · Configuration, font and size propagation**: horizontal; anchored to Session/core → `Configuration, font selection and geometry (src/Surface.zig)`. Conditional config derivation, copied settings, binding-state reset, preserved manual font size, grid acquisition and renderer handoff, metric-driven cell size, separately derived worker configs, resize fan-out (immediate renderer geometry vs. coalesced IO resize and its follow-up renderer notification). Live config changes do not restart the child. Sources: `src/Surface.zig`, `src/termio/Thread.zig`, `src/termio/Termio.zig`, `src/renderer/Thread.zig`. (1–5)
- **inspection · Optional inspector model and hooks**: vertical; anchored to Session/core → `Inspector: optional owned Inspector (src/inspector/Inspector.zig)`. Decompose Inspector into mouse inspection and GUI state, with keyboard history and VT recording beneath GUI state. Expose its hooks as E lines: activation publishes a borrowed pointer under the shared mutex, encoded-key capture, byte-wise PTY recording. Keep runtime inspector presentation outside. Sources: `src/inspector/Inspector.zig`, `src/Surface.zig`, `src/termio/Termio.zig`. (4, 5, 3)

### Links
- `Session/core → Surface` → `Session/inspection → Inspector` · T · optional allocation owned and destroyed by Surface.
- `Session/inspection → Inspector` → `Session/inspection → mouse inspection, GUI state` · T · inspector state.
- `Session/inspection → GUI state` → `Session/inspection → keyboard history, VT recording` · T · recording containers.
- `Session/core → User interaction and terminal actions` → `Interaction/state → Keyboard, Mouse` · T · entrance to the Interaction canvas.
- `Session/core → Session IO and emulation` → `IO/parts → Termio, IO thread, worker handle` · T · entrance to the IO canvas.
- `Session/core → Presentation` → `Presentation/parts → renderer.State, renderer, thread controller, worker handle` · T · entrance to the Presentation canvas.
- `Session/core → Search` → `Search/structure → Search` · T · entrance to the Search canvas.
- `Session/lifecycle → close()` → `Host/boundary → runtime Surface.close()` · E · request host closure with confirmation policy; not destruction.
- `Host/boundary → runtime destruction` → `Session/lifecycle → deinit()` · E · host completes core shutdown.
- `Session/lifecycle → deinit()` → `Search/structure → worker` · E · stop/join first, releasing references into terminal storage.
- `Session/lifecycle → deinit()` → `Presentation/schedule → renderer worker` · E · stop/join before renderer destruction.
- `Session/lifecycle → deinit()` → `IO/transport → IO writer worker` · E · stop/join; backend shutdown also joins its reader pipeline.
- `Session/lifecycle → final cleanup` → `Host/fonts → SharedGridSet.deref()` · E · release the Surface's remaining grid reference.
- `Session/reconfigure → updateConfig()` → `Interaction/state → sequence and table state` · E · clear references into replaced bindings.
- `Session/reconfigure → setFontSize()` → `Host/fonts → SharedGridSet` · E · acquire a matching grid reference.
- `Session/reconfigure → font-grid message` → `Presentation/schedule → renderer mailbox` · E · install the new grid, then release the old key.
- `Session/reconfigure → resize/config messages` → `IO/transport → IO mailbox` · E · coalesced PTY/terminal geometry and derived Termio config.
- `Session/reconfigure → resize/config messages` → `Presentation/schedule → renderer mailbox` · E · immediate screen/padding geometry and renderer config.
- `Session/inspection → activation` → `Presentation/parts → renderer.State.inspector` · E · publish/clear borrowed pointer under the shared mutex.
- `Interaction/dispatch → key handling` → `Session/inspection → keyboard history` · E · copy encoded bytes before IO can release them.
- `IO/transport → processOutput()` → `Session/inspection → VT recording` · E · byte-wise recording while the inspector is attached.

## Interaction · child of Session/core → `User interaction and terminal actions (src/Surface.zig)`

Separates retained interaction state from decision paths and the asynchronous clipboard protocol. Byte-producing paths end at the IO mailbox; backend internals stay on IO. (5, primary; 1, 3, 4)

### Diagrams
- **state · Keyboard and mouse composition**: vertical; anchored to Session/core → `User interaction and terminal actions (src/Surface.zig)`. Keyboard's sequence state, owned queued writes and table stack; borrowed binding sets as E. Mouse's button/modifier state, SelectionGesture, scroll accumulation and link state. `pressed_key` and `last_binding_trigger` as Surface siblings. Sources: `src/Surface.zig`.
- **dispatch · Input decisions and outgoing messages**: horizontal; anchored to Session/core → `keyCallback() -> maybeHandleBinding() -> performBindingAction()`. Modifier remapping, binding consumption vs. mode-sensitive encoding, sequences and key tables, mouse branches (local selection/scrolling vs. application reports vs. URL actions), preedit as renderer-facing display state, readonly filtering at `queueIo()`. Sources: `src/Surface.zig`, `src/surface_mouse.zig`, `src/input/key_encode.zig`, `src/input/mouse_encode.zig`.
- **clipboard · Clipboard request lifecycle**: horizontal; anchored to Session/core → `Text, IME and clipboard operations`. Ordinary paste, MIME-list paste, OSC 52 and Kitty reads/writes traced separately: permission checks, pending-request ownership, completion/denial, session grants and protocol replies. Sources: `src/Surface.zig`, `src/termio/stream_handler.zig`, `src/apprt/embedded.zig`.

### Links
- `Interaction/state → Keyboard` → `Interaction/state → sequence state, queued writes, table stack` · T · keyboard members.
- `Interaction/state → Mouse` → `Interaction/state → SelectionGesture, button/modifier, scroll/link state` · T · mouse members.
- `Interaction/state → table entries` → `Session/core → config: DerivedConfig` · E · borrow configuration-owned binding sets.
- `Interaction/dispatch → callbacks` → `Interaction/state → Keyboard, Mouse` · E · update interaction state.
- `Interaction/dispatch → encoders` → `Emulator/state → Terminal modes` · E · read protocol modes under the shared mutex to choose emitted bytes.
- `Interaction/dispatch → selection and scrolling` → `Emulator/storage → Screen selection, PageList viewport` · E · mutate local state without PTY writes.
- `Interaction/dispatch → queueIo()` → `IO/transport → IO mailbox` · E · transfer allowed messages; discard write variants in readonly mode.
- `Interaction/dispatch → preeditCallback()` → `Presentation/parts → renderer.State.preedit` · E · replace composition text and request rendering.
- `Interaction/dispatch → host actions` → `Host/boundary → runtime action handler` · E · navigation, URL opening, UI changes.
- `IO/protocol → StreamHandler` → `Interaction/clipboard → request handling` · E · protocol clipboard requests arrive via the surface-addressed App mailbox.
- `Interaction/clipboard → request handling` → `Host/boundary → runtime clipboard services` · E · request data, writes or confirmation.
- `Host/boundary → clipboard completion/denial` → `Interaction/clipboard → continuation` · E · resume or reject the pending request.
- `Interaction/clipboard → paste, replies, grants` → `Interaction/dispatch → queueIo()` · E · submit encoded writes or grant messages.

## IO · child of Session/core → `Session IO and emulation: io, io_thread, io_thr`

Separates ownership from execution lanes and protocol interpretation. Emulator storage opens one level further down. (4 primary; 1, 2, 3, 5)

### Diagrams
- **parts · Termio and execution-state composition**: vertical; anchored to Session/core → `Session IO and emulation: io, io_thread, io_thr`. Termio, IO thread controller and worker handle as Surface siblings. Termio → backend, stream, terminal, mailbox, DerivedConfig. Exec → Subprocess; thread-entry resources (writer stream, process watcher, reader handle, termios timer) under ThreadData. IO-thread timers: resize coalescing, selection scroll, synchronized-output. Sources: `src/Surface.zig`, `src/termio/Termio.zig`, `src/termio/Thread.zig`, `src/termio/Exec.zig`.
- **protocol · Stateful stream interpretation**: vertical; anchored to Session/core → `terminal_stream: StreamHandler.Stream (src/termio/stream_handler.zig)`. Stream → parser and StreamHandler; handler → APC/DCS state, clipboard transactions/grants, build-gated tmux state. Exits as E lines: terminal operations, replies, host notifications, renderer wakeups. Do not catalogue escape sequences. Sources: `src/terminal/stream.zig`, `src/termio/stream_handler.zig`.
- **transport · Worker lanes, backpressure and control**: horizontal; anchored to Session/core → `io: termio.Termio (src/termio/Termio.zig)`. Incoming: POSIX PTY → gather → bounded rotating buffers → parser worker → `processOutput()` under the shared mutex; Windows serial reader. Outgoing: mailbox → writer → backend writes/control. Queue-full mutex release/reacquire, parser demand handoff, resize ordering, synchronized-output timeout, child-exit notification. Sources: `src/termio/Exec.zig`, `src/termio/Thread.zig`, `src/termio/Termio.zig`, `src/termio/mailbox.zig`.

### Links
- `IO/parts → Termio` → `IO/parts → backend, mailbox, DerivedConfig` · T · owned IO members.
- `IO/parts → Termio` → `IO/protocol → stream` · T · owns persistent parser/handler state.
- `IO/parts → Termio` → `Emulator/state → Terminal` · T · owns the authoritative emulator; entrance to the Emulator canvas.
- `IO/parts → Exec` → `IO/parts → Subprocess` · T · process/PTY configuration and lifecycle.
- `IO/protocol → stream` → `IO/protocol → parser, StreamHandler` · T · parser state and dispatch handler.
- `IO/protocol → StreamHandler` → `IO/protocol → APC/DCS, clipboard, tmux state` · T · protocol-specific state.
- `IO/transport → gather worker` → `IO/transport → parser worker` · E · bounded buffer ownership transfer with backpressure.
- `IO/transport → parser worker` → `IO/protocol → stream` · E · feed batches while holding the shared mutex.
- `IO/transport → IO mailbox` → `IO/transport → writer` · E · drain writes and control operations.
- `IO/protocol → StreamHandler` → `Emulator/state → Terminal` · E · apply decoded terminal operations.
- `IO/protocol → StreamHandler` → `IO/transport → IO mailbox` · E · enqueue protocol replies directly, bypassing Surface's readonly gate.
- `IO/protocol → StreamHandler` → `Host/boundary → App mailbox` · E · surface-addressed title, clipboard and other notifications.
- `IO/protocol → StreamHandler` → `Presentation/schedule → renderer wakeup` · E · request a frame.
- `IO/transport → child-exit watcher` → `Host/boundary → App mailbox` · E · deliver child-exit status to Surface.
- `IO/transport → Termio.resize()` → `Emulator/state → Terminal` · E · resize PTY and terminal under the same mutex.
- `IO/transport → Termio.resize()` → `Presentation/schedule → renderer mailbox` · E · second resize notification after the terminal resize.
- `IO/transport → parser batch boundary` → `Presentation/parts → renderer.State demand counters` · E · yield to a waiting snapshot.
- `IO/transport → synchronized-output timer` → `Emulator/state → synchronized-output mode` · E · clear a stalled rendering pause.

## Emulator · child of IO/parts → `terminal: terminal.Terminal -- authoritative emulator state`

Mutable terminal storage gets its own hierarchy. It is shared by access, not jointly owned by renderer, search and Surface. (4 primary; 2, 3)

### Diagrams
- **state · Terminal-wide and screen-set state**: vertical; anchored to IO/parts → `terminal: terminal.Terminal -- authoritative emulator state`. Modes, colors, dimensions, title, working directory, tabstops and scrolling region beside ScreenSet; primary screen, lazily created alternate, active-screen alias, generation counters. Sources: `src/terminal/Terminal.zig`, `src/terminal/ScreenSet.zig`.
- **storage · Screens, pages and stable references**: vertical; anchored to Session/core → `screens: ScreenSet -- primary/alternate Screen instances`. Screen → PageList, cursor/saved cursor, selection, charset, semantic-prompt and Kitty state. PageList → page nodes (resident/compressed), viewport, tracked pins, compression continuation. Resident Page → rows/cells, styles, graphemes, hyperlinks. Sources: `src/terminal/Screen.zig`, `src/terminal/PageList.zig`, `src/terminal/page.zig`.
- **validity · Mutation and reference validity**: horizontal; anchored to Emulator/storage → `PageList`. Resize/reflow, pruning and screen replacement against cursor/selection pins, search generations and copied rendering highlights. Distinguish tracked references from values that need validation. Sources: `src/terminal/ScreenSet.zig`, `src/terminal/Screen.zig`, `src/terminal/PageList.zig`, `src/terminal/search/terminal.zig`, `src/renderer/generic.zig`.

### Links
- `Emulator/state → Terminal` → `Emulator/state → ScreenSet` · T · owns the screen collection.
- `Emulator/state → ScreenSet` → `Emulator/storage → primary Screen` · T · always initialized.
- `Emulator/state → ScreenSet` → `Emulator/storage → alternate Screen` · T · optional, lazily initialized.
- `Emulator/state → active pointer` → `Emulator/storage → selected Screen` · E · aliases an existing screen.
- `Emulator/storage → Screen` → `Emulator/storage → PageList` · T · owns grid and scrollback.
- `Emulator/storage → Screen` → `Emulator/storage → cursor, selection, charset, Kitty state` · T · screen-local state beside PageList.
- `Emulator/storage → PageList` → `Emulator/storage → page nodes` · T · ordered storage, resident or compressed.
- `Emulator/storage → resident Page` → `Emulator/storage → rows, cells, auxiliary tables` · T · page-contained data.
- `Emulator/validity → tracked cursor/selection references` → `Emulator/storage → PageList pins` · E · maintained across storage mutations.

## Presentation · child of Session/core → `Presentation: renderer, renderer_state, renderer_thread, renderer_thr`

Separates the snapshot boundary, renderer-owned resources and the scheduler, so the borrowed terminal pointer never reads as renderer-owned state. (4, 1 primary; 2, 3, 5)

### Diagrams
- **parts · Shared access and per-surface resources**: vertical; anchored to Session/core → `Presentation: renderer, renderer_state, renderer_thread, renderer_thr`. `renderer.State` (mutex, demand counters, preedit, mouse state, borrowed terminal/inspector pointers), renderer implementation (RenderState snapshot, shaper/cache, cells/images/highlights, draw mutex, graphics API, swap chain, shaders, optional display link), thread controller and worker handle as siblings. Font grid and App device as borrowed E. Sources: `src/renderer/State.zig`, `src/renderer/generic.zig`, `src/renderer/Thread.zig`.
- **frame · Snapshot to frame**: horizontal; anchored to Session/core → `updateFrame() -> snapshots shared terminal state under renderer_state lock`. Demand-locked snapshot; limited terminal mutations (viewport scroll, Kitty animation); preedit/mouse/highlight extraction; work outside the terminal lock; shaping and glyph lookup; atlas sync; draw submission. Separate terminal synchronization from `draw_mutex`; no full terminal copy per frame. Sources: `src/renderer/generic.zig`, `src/terminal/render.zig`, `src/renderer/State.zig`.
- **schedule · Wake, update, draw and maintenance**: horizontal; anchored to Session/core → `renderer_thread: renderer.Thread; renderer_thr: worker handle`. Mailbox draining, blink/animation timers, visibility and display-realization gates, synchronized-output suppression, vsync/display-link draws, host-driven `Surface.draw()` (draws without `updateFrame`), compression scheduling. Sources: `src/renderer/Thread.zig`, `src/renderer/generic.zig`, `src/Surface.zig`.

### Links
- `Presentation/parts → renderer` → `Presentation/frame → RenderState snapshot` · T · renderer-owned captured state, distinct from Terminal.
- `Presentation/parts → renderer` → `Presentation/parts → shaping and GPU resources` · T · per-surface caches and graphics resources.
- `Presentation/parts → thread controller` → `Presentation/schedule → mailbox, signals, timers, compression scheduler` · T · scheduling machinery.
- `Presentation/parts → renderer.State.terminal` → `Emulator/state → Terminal` · E · borrowed access protected by the shared mutex.
- `Presentation/frame → updateFrame()` → `Presentation/parts → renderer.State` · E · acquire/release the demand lock around snapshot extraction.
- `Presentation/frame → updateFrame()` → `Emulator/storage → viewport, Kitty animation` · E · limited mutation under the lock.
- `Presentation/frame → search highlights` → `Emulator/validity → page identity validation` · E · validate asynchronous highlights before applying them.
- `Presentation/frame → shaping and atlas sync` → `Host/fonts → SharedGrid` · E · resolve/rasterize glyphs with grid locking.
- `Presentation/parts → graphics API` → `Host/resources → App device` · E · borrow the app-scoped device.
- `Presentation/schedule → render callback` → `Presentation/frame → updateFrame()` · E · build frame data when visible and realized.
- `Presentation/schedule → draw signal` → `Presentation/frame → drawFrame()` · E · draw per visibility and vsync policy.
- `Session/core → Surface.draw()` → `Presentation/frame → drawFrame(true)` · E · synchronous host-driven draw.
- `Presentation/schedule → font-grid handler` → `Host/fonts → SharedGridSet.deref(old)` · E · retire the old grid only after installing its replacement.
- `Presentation/schedule → compression timer` → `Emulator/storage → PageList` · E · schedule terminal-owned incremental compression.
- `Presentation/frame → scrollbar/frame notifications` → `Host/boundary → App mailbox` · E · return presentation changes to the main thread.

## Search · child of Session/core → `Search: optional Surface.Search (src/Surface.zig)`

Search keeps independent mutable state across screen changes and delivers results asynchronously, so it gets its own canvas rather than a Session diagram. (4 primary; 1, 2, 3, 5)

### Diagrams
- **structure · Worker and incremental search state**: vertical; anchored to Session/core → `Search: optional Surface.Search (src/Surface.zig)`. Search → worker state and handle; worker state → mailbox, refresh timer, optional TerminalSearch; TerminalSearch → viewport search and per-live-screen ScreenSearch with active/history results and selected-match tracking. These hold references into terminal storage, never owned screens. Sources: `src/Surface.zig`, `src/terminal/search/Thread.zig`, `src/terminal/search/terminal.zig`, `src/terminal/search/screen.zig`.
- **results · Feed, progress and delivery**: horizontal; anchored to Session/core → `searchCallback_() -> renderer mailbox with viewport/selected-match highlights`. Locked feed vs. work on copied data, refresh/progress, match selection (which can move the viewport), highlight cloning, separate UI-count delivery, quit clearing renderer search state. Sources: `src/terminal/search/Thread.zig`, `src/terminal/search/terminal.zig`, `src/Surface.zig`.

### Links
- `Search/structure → Search` → `Search/structure → worker state, handle` · T · owns dedicated search execution.
- `Search/structure → worker state` → `Search/structure → TerminalSearch` · T · optional active search.
- `Search/structure → TerminalSearch` → `Search/structure → viewport and per-screen searchers` · T · search-owned matching state.
- `Interaction/dispatch → search actions` → `Search/structure → mailbox` · E · set query or navigate matches.
- `Search/results → feed/select` → `Emulator/state → Terminal` · E · read under shared locking; selection can move the viewport.
- `Search/structure → TerminalSearch` → `Emulator/state → screen generations` · E · detect replaced screens even if addresses are reused.
- `Search/results → searchCallback_()` → `Presentation/schedule → renderer mailbox` · E · transfer cloned viewport/selected highlights.
- `Search/results → searchCallback_()` → `Host/boundary → App mailbox` · E · deliver match total and selected index to Surface.

## Host · same level as Session

App-wide resources and runtime services are collaborators of a session, not Surface parts. Connecting E relations: worker → App mailbox → Surface dispatch; Surface → runtime actions/clipboard/close; runtime → Surface callbacks; Surface → font-set references; renderer → shared grid/device. (4, 5 primary; 1, 2, 3)

### Diagrams
- **boundary · Main-thread routing and runtime contract**: horizontal; anchored to Session/core → `surfaceMailbox(), handleMessage() (src/Surface.zig; src/apprt/surface.zig)`. Envelope construction, App queue, runtime wakeup, live-surface validation, `handleMessage()`, `performAction()`, and the runtime callback/service contract (input, geometry, clipboard, close). Use the embedded runtime's `core_surface` as a concrete example, not a universal host layout. Sources: `src/App.zig`, `src/apprt.zig`, `src/apprt/surface.zig`, `src/apprt/embedded.zig`.
- **resources · App-owned resources**: vertical; anchored to Session/core → `app, rt_app, rt_surface -- references, not owned application objects`. App → runtime-surface registry, mailbox, SharedGridSet, optional render device. Registry entries reference runtime surfaces; unregistering does not destroy them. Sources: `src/App.zig`.
- **fonts · Shared font storage**: vertical; anchored to Session/core → `font_grid_key, font_size, font_metrics, font_size_adjusted`. SharedGridSet → keyed reference-counted entries, font library, discovery; SharedGrid → resolver, metrics, codepoint/glyph caches, grayscale/color atlases, lock. One identity for a grid shared by several surfaces; per-renderer shaping and GPU textures stay on Presentation. Sources: `src/font/SharedGridSet.zig`, `src/font/SharedGrid.zig`.

### Links
- `Host/resources → App` → `Host/resources → registry, mailbox, device` · T · app-owned members.
- `Host/resources → App` → `Host/fonts → SharedGridSet` · T · owns shared font infrastructure.
- `Host/fonts → SharedGridSet` → `Host/fonts → SharedGrid entries` · T · owns reference-counted grids.
- `Host/fonts → SharedGrid` → `Host/fonts → resolver, caches, atlases, lock` · T · shared CPU-side font data.
- `Session/core → app reference` → `Host/resources → App` · E · non-owning application reference.
- `Session/core → font_grid_key` → `Host/fonts → SharedGrid` · E · retains a grid reference, not grid storage.
- `Host/resources → registry` → `Host/boundary → runtime surfaces` · E · track registered surfaces.
- `Host/boundary → surface mailbox wrapper` → `Host/resources → mailbox` · E · enqueue an addressed envelope and wake the runtime.
- `Host/boundary → App dispatch` → `Session/core → handleMessage()` · E · deliver only while the surface remains registered.
- `Session/core → rt_app.performAction()` → `Host/boundary → runtime action handler` · E · titles, notifications, scrollbar and UI changes.
- `Host/boundary → runtime callbacks` → `Interaction/dispatch → callbacks` · E · deliver keyboard, mouse, text and IME events.
- `Host/boundary → geometry/config callbacks` → `Session/reconfigure → propagation` · E · initiate size, scale and settings changes.

# Summary

Seven canvases: the Session root, five child canvases (Interaction, IO, Presentation and Search under Session; Emulator under IO) and one same-level Host canvas. The 21 diagrams split 10 vertical / 11 horizontal. Vertical depth goes where real ownership is rich (IO, emulator storage, rendering resources, search, App fonts). Horizontal views expose lifecycle ordering, input and clipboard round trips, worker lanes and backpressure, locking, frame scheduling and main-thread delivery.

Corrections to the input confirmed across samples, all at `ea8b12a8a9894b5259c441eadd8f6f0c65e215af`:
- POSIX PTY output is a gather → parser pipeline, not one reader loop; Windows keeps a serial reader. (1–5)
- Cursor, selection, charset and Kitty state belong to Screen beside PageList. (1–5)
- `queueIo()` is a Surface write gate; protocol replies bypass it. (1–5)
- Font replacement releases the old reference on the renderer thread after installation. (1–5)
- Resize reaches the renderer twice: directly and after Termio's locked resize. (2, 3, 5)
- Wakeup → update → draw is conditional; host-driven drawing does not imply a fresh snapshot. (1–5)
- `updateFrame()` can mutate viewport and Kitty animation state. (2, 5)
- The stream also holds clipboard transaction/grant and optional tmux state omitted from the input. (3, 4)
