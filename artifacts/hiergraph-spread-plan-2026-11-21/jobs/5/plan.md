# Compression

## Vertical
- `User interaction and terminal actions (src/Surface.zig)`: combines retained keyboard/mouse state, binding dispatch, protocol encoding and asynchronous clipboard transactions. Keyboard tables borrow configuration data; clipboard requests have distinct ownership and permission paths. Sources: `src/Surface.zig`, `src/apprt/structs.zig`.
- `Session IO and emulation: io, io_thread, io_thr`: hides the distinction between Surface-owned fields, Termio-owned state and backend thread-local resources. POSIX output uses separate gather and parse workers, not just one reader. Sources: `src/Surface.zig`, `src/termio/Termio.zig`, `src/termio/Exec.zig`, `src/termio/Thread.zig`.
- `terminal: terminal.Terminal -- authoritative emulator state`: compresses Terminal → ScreenSet → Screens → PageList. Cursor, selection, charset and Kitty state are Screen members alongside PageList, not its children. PageList contains page storage, tracked pins, viewport and compression continuation state. Sources: `src/terminal/Terminal.zig`, `src/terminal/ScreenSet.zig`, `src/terminal/Screen.zig`, `src/terminal/PageList.zig`.
- `Presentation: renderer, renderer_state, renderer_thread, renderer_thr`: flattens four Surface members. The renderer contains a snapshot, shaping state, renderable cells/images, graphics resources and a separate draw mutex; renderer.State references the authoritative terminal. Sources: `src/Surface.zig`, `src/renderer/generic.zig`, `src/renderer/State.zig`, `src/renderer/Thread.zig`.
- `Search: optional Surface.Search (src/Surface.zig)`: hides per-screen searchers, an active-viewport search and screen-generation tracking beneath the worker. Sources: `src/terminal/search/Thread.zig`, `src/terminal/search/terminal.zig`.
- `Inspector: optional owned Inspector (src/inspector/Inspector.zig)`: keyboard history and VT recording sit beneath GUI state; the renderer-state inspector pointer is only a reference. Sources: `src/inspector/Inspector.zig`, `src/Surface.zig`.
- `app, rt_app, rt_surface -- references, not owned application objects`: adjacent application responsibilities deserve separate identities. App owns the shared font-grid set and render device; the grid set owns reference-counted grids. Sources: `src/App.zig`, `src/font/SharedGridSet.zig`, `src/font/SharedGrid.zig`.

## Horizontal
- `surfaceMailbox(), handleMessage() (src/Surface.zig; src/apprt/surface.zig)`: surface mailboxes are addressing wrappers over App’s queue. Posting wakes the runtime; dispatch checks that the destination surface still exists. Sources: `src/apprt/surface.zig`, `src/App.zig`.
- `Lifecycle implementation: init(), deinit(), needsConfirmQuit(), close()`: close requests cross into the host, whereas destruction stops and joins workers before releasing shared state. Renderer destruction must precede renderer-thread-state destruction because of display-link callbacks. Sources: `src/Surface.zig`, `src/apprt/embedded.zig`.
- `Configuration, font selection and geometry (src/Surface.zig)`: reload invalidates binding references, acquires a grid, transfers its replacement to the renderer and sends independently derived worker configurations. Resize reaches the renderer both directly and after IO resizes the PTY and terminal. Sources: `src/Surface.zig`, `src/renderer/Thread.zig`, `src/termio/Termio.zig`.
- `queueIo() -- common outgoing-message gate`: ownership transfer, readonly filtering and bounded-queue backpressure are compressed into one arrow. Protocol handlers can send directly to the IO mailbox; this is not a universal gate for every PTY write. Sources: `src/Surface.zig`, `src/termio/mailbox.zig`, `src/termio/stream_handler.zig`.
- `renderer_state: renderer.State (src/renderer/State.zig)`: shared locking connects parsing, interaction, search and frame snapshots. Demand counters and reader yielding prevent busy parsing from starving snapshots. Sources: `src/renderer/State.zig`, `src/termio/Exec.zig`, `src/renderer/generic.zig`.
- `Text, IME and clipboard operations`: mixes display-only preedit, ordinary paste, OSC 52 and Kitty clipboard permission/response cycles. Sources: `src/Surface.zig`, `src/termio/stream_handler.zig`, `src/apprt/embedded.zig`.
- `renderer_thread: renderer.Thread; renderer_thr: worker handle`: wakeup, snapshot and drawing are not an unconditional linear sequence. Visibility, synchronized output and vsync affect execution; compression scheduling also reaches back into terminal storage. Sources: `src/renderer/Thread.zig`, `src/renderer/generic.zig`.

# Canvases

Node-qualified references below identify endpoints inside diagrams. Repeated endpoint references retain one identity; they do not create additional owned copies. T denotes direct composition, never a call, pointer or scheduling relationship.

## Session · current

Keep the input as an orientation map. Move expanded interiors to their designated diagrams rather than reproducing the dense tree.

### Diagrams
- **core · Surface ownership index**: vertical; anchored to the supplied root `Ghostty terminal-session core -- Surface (src/Surface.zig)`. Retain the input diagram as a corrected, collapsed index of Surface fields and responsibility groups. Distinguish owned members from external references. Sources: `src/Surface.zig`.
- **lifecycle · Construction and teardown boundary**: horizontal; anchored to Session/core → `Lifecycle implementation: init(), deinit(), needsConfirmQuit(), close()`. Show initialization, worker startup, host-mediated close and ordered teardown. Include search → renderer → IO stop/join ordering, backend reader shutdown, renderer-before-thread-state destruction and final grid release. Sources: `src/Surface.zig`, `src/termio/Exec.zig`, `src/apprt/embedded.zig`.
- **reconfigure · Configuration, font and resize propagation**: horizontal; anchored to Session/core → `Configuration, font selection and geometry (src/Surface.zig)`. Trace conditional configuration, binding-state invalidation, grid acquisition/replacement, derived worker configurations and geometry fan-out. Mark IO resize coalescing and the subsequent renderer resize notification. Sources: `src/Surface.zig`, `src/termio/Thread.zig`, `src/termio/Termio.zig`, `src/renderer/Thread.zig`.
- **search · Search composition and result ports**: vertical; anchored to Session/core → `Search: optional Surface.Search (src/Surface.zig)`. Decompose state and worker handle; beneath state show mailbox, refresh timer, notification bookkeeping and optional TerminalSearch. Decompose TerminalSearch into per-live-screen searchers, viewport search, cached matches and generation tracking. Expose locked feed/select and asynchronous result ports without duplicating terminal storage. Sources: `src/Surface.zig`, `src/terminal/search/Thread.zig`, `src/terminal/search/terminal.zig`.
- **inspector · Optional instrumentation state**: vertical; anchored to Session/core → `Inspector: optional owned Inspector (src/inspector/Inspector.zig)`. Show mouse inspection and GUI state, with keyboard history and VT-stream recording beneath GUI state. Expose activation, input-event and PTY-byte ports. Sources: `src/inspector/Inspector.zig`, `src/Surface.zig`, `src/termio/Termio.zig`.

### Links
- `Session/core::Surface` → `Session/search::Search` · T · optional owned search state.
- `Session/search::Search` → `Session/search::state, thread` · T · worker controller and handle.
- `Session/search::state` → `Session/search::TerminalSearch` · T · optional active search.
- `Session/search::TerminalSearch` → `Session/search::screen searchers, viewport search, cached results` · T · search-owned working data.
- `Session/core::Surface` → `Session/inspector::Inspector` · T · optional allocated inspector.
- `Session/inspector::Inspector` → `Session/inspector::mouse, GUI` · T · inspector state.
- `Session/inspector::GUI` → `Session/inspector::keyboard history, VT recording` · T · recording containers.
- `Session/lifecycle::close` → `Application/boundary::runtime Surface` · E · request host closure with confirmation policy.
- `Application/boundary::runtime Surface` → `Session/lifecycle::deinit` · E · host completes core destruction.
- `Session/lifecycle::deinit` → `Session/search::Search, Presentation/parts::renderer worker, IO/parts::IO worker` · E · stop and join before resource release.
- `Session/reconfigure::updateConfig` → `Interaction/state::Keyboard` · E · clear sequences and tables that reference replaced configuration.
- `Session/reconfigure::setFontSize` → `Application/fonts::SharedGridSet` · E · acquire matching grid reference.
- `Session/reconfigure::grid replacement` → `Presentation/parts::renderer mailbox` · E · transfer new grid and old-key release obligation.
- `Session/reconfigure::resize` → `IO/parts::IO mailbox` · E · submit coalescible geometry update.
- `Session/reconfigure::resize` → `Presentation/parts::renderer mailbox` · E · submit screen/padding geometry.
- `Session/reconfigure::updateConfig` → `IO/parts::Termio config, Presentation/parts::renderer configs` · E · transfer separately derived configurations.
- `Session/search::worker` → `IO/terminal::Terminal` · E · locked feed and match selection; selection can move the viewport.
- `Session/search::callback` → `Presentation/parts::renderer mailbox` · E · transfer cloned highlight data.
- `Session/search::callback` → `Application/boundary::App mailbox` · E · surface-addressed match totals and selected index.
- `Session/inspector::activation` → `Presentation/parts::renderer.State` · E · publish or remove borrowed inspector reference under lock.
- `Interaction/dispatch::key handling` → `Session/inspector::keyboard history` · E · record event and copied encoded bytes.
- `IO/output::processOutput` → `Session/inspector::VT recording` · E · inspector-enabled byte-wise recording before parsing.

## Interaction · child of Session/core → `User interaction and terminal actions (src/Surface.zig)`

Separate retained interaction state from decision paths and asynchronous clipboard protocols. This canvas ends at mailbox, terminal-state and runtime-service ports.

### Diagrams
- **state · Keyboard and mouse composition**: vertical; anchored to Session/core → `User interaction and terminal actions (src/Surface.zig)`. Show Keyboard’s sequence pointer, owned queued writes and table stack; distinguish borrowed binding sets. Show Mouse’s button/modifier state, selection gesture, scroll accumulation and link state. Keep `pressed_key` and `last_binding_trigger` as Surface siblings, not Keyboard fields. Sources: `src/Surface.zig`.
- **dispatch · Input decisions and outgoing messages**: horizontal; anchored to Session/core → `keyCallback() -> maybeHandleBinding() -> performBindingAction()`. Trace modifier remapping, binding consumption, mode-sensitive encoding and readonly filtering. Add mouse branches for local selection/scrolling, application reports and URL actions. Show preedit as renderer-facing state rather than PTY input. Sources: `src/Surface.zig`, `src/surface_mouse.zig`.
- **clipboard · Clipboard request lifecycle**: horizontal; anchored to Session/core → `Text, IME and clipboard operations`. Trace ordinary paste, MIME-list paste events, OSC 52 and Kitty reads/writes separately. Show permission checks, pending-request ownership, completion/denial, session grants and protocol replies. `textCallback()` enters paste handling; OSC 52 writes do not pass through `startClipboardRequest()`. Sources: `src/Surface.zig`, `src/termio/stream_handler.zig`, `src/apprt/embedded.zig`.

### Links
- `Session/core::interaction group` → `Interaction/state::Keyboard, Mouse, pressed_key, last_binding_trigger` · T · retained interaction parts.
- `Interaction/state::Keyboard` → `Interaction/state::sequence state, queued writes, table stack, last_trigger` · T · keyboard members.
- `Interaction/state::Mouse` → `Interaction/state::SelectionGesture, button/modifier state, scroll/link state` · T · mouse members.
- `Interaction/state::binding references` → `Session/core::DerivedConfig` · E · borrow binding sets from surface configuration.
- `Interaction/dispatch::callbacks` → `Interaction/state::Keyboard, Mouse` · E · update interaction state.
- `Interaction/dispatch::encoders` → `IO/terminal::Terminal` · E · read protocol modes under shared locking.
- `Interaction/dispatch::selection and scrolling` → `IO/terminal::Screen, PageList` · E · mutate local selection/viewport rather than write PTY bytes.
- `Interaction/dispatch::queueIo` → `IO/parts::IO mailbox` · E · transfer allowed messages; discard write variants in readonly mode.
- `Interaction/dispatch::preedit` → `Presentation/parts::renderer.State.preedit` · E · replace composition display state and request rendering.
- `Interaction/dispatch::host actions` → `Application/boundary::runtime services` · E · request navigation, URL opening and UI changes.
- `IO/output::StreamHandler` → `Interaction/clipboard::request handling` · E · deliver protocol requests through the surface-addressed App mailbox.
- `Interaction/clipboard::request handling` → `Application/boundary::runtime clipboard` · E · request data, writes or confirmation.
- `Application/boundary::runtime clipboard` → `Interaction/clipboard::completion or denial` · E · return asynchronous result while respecting request ownership.
- `Interaction/clipboard::paste, replies and grants` → `Interaction/dispatch::queueIo` · E · submit encoded writes or grant messages.

## IO · child of Session/core → `Session IO and emulation: io, io_thread, io_thr`

Open the authoritative state and execution machinery together, but distinguish ownership from the threads that operate on it.

### Diagrams
- **parts · IO ownership and execution resources**: vertical; anchored to Session/core → `Session IO and emulation: io, io_thread, io_thr`. Separate Surface’s Termio, thread controller and handle. Decompose Termio into backend, terminal, stream, config and mailbox. Show Exec’s Subprocess separately from thread-local writer stream, process watcher, reader handle and termios timer. Show IO-thread resize-coalescing, selection-scroll and synchronized-output timers. Sources: `src/Surface.zig`, `src/termio/Termio.zig`, `src/termio/Thread.zig`, `src/termio/Exec.zig`.
- **terminal · Emulator storage hierarchy**: vertical; anchored to Session/core → `terminal: terminal.Terminal -- authoritative emulator state`. Expand ScreenSet’s primary and lazily initialized alternate screens; show the active pointer as a relation. Decompose Screen and PageList accurately, including viewport/pin tracking and compression state. Keep modes, colors, title and working directory at Terminal level. Sources: `src/terminal/Terminal.zig`, `src/terminal/ScreenSet.zig`, `src/terminal/Screen.zig`, `src/terminal/PageList.zig`.
- **output · PTY, parser and reply paths**: horizontal; anchored to Session/core → `PTY reader -> Termio.processOutput(); exit notification -> Surface`. Trace POSIX gather → bounded rotating buffers → parser worker; contrast Windows’ serial reader. Continue through locked parsing, terminal mutations, replies, renderer wakeups and surface messages. Include mailbox full-queue lock release/reacquisition, writer-side operations, resize ordering and child-exit reporting. Sources: `src/termio/Exec.zig`, `src/termio/Termio.zig`, `src/termio/stream_handler.zig`, `src/termio/mailbox.zig`.

### Links
- `Session/core::IO group` → `IO/parts::Termio, IO thread controller, worker handle` · T · Surface-owned siblings.
- `IO/parts::Termio` → `IO/parts::backend, stream, config, mailbox` · T · owned IO components.
- `IO/parts::Termio` → `IO/terminal::Terminal` · T · authoritative emulator instance.
- `IO/parts::Exec` → `IO/parts::Subprocess` · T · backend process configuration and lifecycle state.
- `IO/parts::ThreadData` → `IO/parts::backend thread resources` · T · resources established during thread entry.
- `IO/parts::stream` → `IO/output::parser, StreamHandler` · T · parser and handler state.
- `IO/output::StreamHandler` → `IO/output::APC, DCS, clipboard transaction/grant state` · T · protocol-specific state.
- `IO/terminal::Terminal` → `IO/terminal::ScreenSet, modes, colors, tabstops, title, working directory` · T · terminal-level state.
- `IO/terminal::ScreenSet` → `IO/terminal::primary Screen, optional alternate Screen` · T · owned screens.
- `IO/terminal::ScreenSet active pointer` → `IO/terminal::selected Screen` · E · alias the active screen.
- `IO/terminal::Screen` → `IO/terminal::PageList, cursor, selection, charset, Kitty state` · T · sibling screen members.
- `IO/terminal::PageList` → `IO/terminal::pages, tracked pins, viewport, compression state` · T · storage and tracking structures.
- `IO/output::PTY gather` → `IO/output::parse worker` · E · bounded-buffer ownership transfer and backpressure.
- `IO/output::processOutput` → `Presentation/parts::shared mutex` · E · protect parser-driven terminal mutations.
- `IO/output::StreamHandler` → `IO/terminal::Terminal` · E · apply decoded operations.
- `IO/output::StreamHandler` → `IO/parts::IO mailbox` · E · enqueue replies independently of Surface’s readonly gate.
- `IO/parts::IO mailbox` → `IO/output::writer/backend` · E · drain writes and control operations.
- `IO/output::resize` → `IO/terminal::Terminal` · E · resize PTY and emulator under the same mutex.
- `IO/output::resize and output processing` → `Presentation/parts::renderer mailbox/wakeup` · E · notify geometry changes and rendering demand.
- `IO/output::surface messages and child exit` → `Application/boundary::App mailbox` · E · cross to main-thread Surface handling.

## Presentation · child of Session/core → `Presentation: renderer, renderer_state, renderer_thread, renderer_thr`

Separate render-owned resources from shared terminal access, then expose the scheduling and snapshot pipeline.

### Diagrams
- **parts · Presentation state and resource ownership**: vertical; anchored to Session/core → `Presentation: renderer, renderer_state, renderer_thread, renderer_thr`. Show renderer, renderer.State, thread controller and handle as siblings. Expand renderer-owned snapshot, shaping/cache state, cells/images, graphics API resources, draw mutex and presentation state. Expand the controller’s mailbox, wake/draw signals and timers. Mark terminal, inspector, device and font-grid pointers as references. Sources: `src/Surface.zig`, `src/renderer/generic.zig`, `src/renderer/State.zig`, `src/renderer/Thread.zig`.
- **frame · Scheduling, snapshot and presentation**: horizontal; anchored to Session/core → `updateFrame() -> snapshots shared terminal state under renderer_state lock`. Trace mailbox drain, visibility/synchronized-output gates, demand-lock snapshot, work outside the terminal lock, shaping/atlas use and GPU drawing. Include vsync/display-link and host-driven drawing paths. Show scrollbar feedback and compression scheduling as separate outbound relations. Sources: `src/renderer/generic.zig`, `src/renderer/Thread.zig`, `src/renderer/State.zig`, `src/Surface.zig`.

### Links
- `Session/core::presentation group` → `Presentation/parts::renderer, renderer.State, thread controller, worker handle` · T · Surface-owned siblings.
- `Presentation/parts::renderer` → `Presentation/parts::snapshot, shaper/cache, cells/images, graphics resources, draw mutex` · T · per-surface rendering resources.
- `Presentation/parts::thread controller` → `Presentation/parts::mailbox, signals, timers, compression scheduler` · T · worker scheduling machinery.
- `Presentation/parts::renderer.State` → `Presentation/parts::preedit, render mouse state, demand counters` · T · shared-access state members.
- `Presentation/parts::renderer.State` → `IO/terminal::Terminal` · E · borrow authoritative state, not own another terminal.
- `Presentation/parts::renderer.State` → `Session/inspector::Inspector` · E · optional borrowed instrumentation pointer.
- `Presentation/frame::snapshot stage` → `Presentation/parts::shared mutex` · E · acquire/release with demand signalling.
- `IO/output::parse worker` → `Presentation/parts::demand counters` · E · yield between batches to waiting snapshot work.
- `Presentation/frame::snapshot stage` → `Presentation/parts::snapshot` · E · refresh render-owned data before unlocked processing.
- `Presentation/frame::shaping and atlas upload` → `Application/fonts::SharedGrid` · E · resolve/rasterize glyphs and consume shared CPU atlases.
- `Presentation/parts::graphics API` → `Application/resources::device` · E · borrow application-scoped render device.
- `Presentation/frame::draw paths` → `Application/boundary::runtime Surface` · E · present or export frames through the host boundary.
- `Presentation/frame::scrollbar feedback` → `Application/boundary::App mailbox` · E · publish surface-addressed UI updates.
- `Presentation/parts::compression scheduler` → `IO/terminal::Terminal compression` · E · schedule locked incremental work; PageList owns continuation state.
- `IO/parts::synchronized-output timer` → `IO/terminal::synchronized-output mode` · E · clear stalled pause so snapshot work can resume.

## Application · same level as Session

Application-wide resources and runtime services are not Surface children. Connecting E relations are Surface → App references, worker → App mailbox delivery, Surface → runtime actions, runtime → Surface callbacks, and renderer → shared device/font-grid borrowing.

### Diagrams
- **resources · Application-owned resources**: vertical; anchored to Session/core → `app, rt_app, rt_surface -- references, not owned application objects`. Expand App’s runtime-surface registry, mailbox, shared grid set and optional render device. Treat registry entries as references, not Surface-owned application objects. Sources: `src/App.zig`.
- **fonts · Shared font storage**: vertical; anchored to Session/core → `font_grid_key, font_size, font_metrics, font_size_adjusted`. Expand the external grid set’s keyed reference-counted entries, font library and discovery state; expand each SharedGrid into resolver, metrics, codepoint/glyph caches, atlas pair and lock. Do not repeat per-renderer shaping or GPU textures. Sources: `src/font/SharedGridSet.zig`, `src/font/SharedGrid.zig`.
- **boundary · Main-thread routing and runtime contract**: horizontal; anchored to Session/core → `surfaceMailbox(), handleMessage() (src/Surface.zig; src/apprt/surface.zig)`. Trace envelope construction, App queue, runtime wakeup, live-surface validation, Surface dispatch and runtime actions/callbacks. Show the embedded runtime’s containing `core_surface` relationship as a concrete implementation example, not a universal layout claim. Sources: `src/App.zig`, `src/apprt/surface.zig`, `src/apprt.zig`, `src/apprt/embedded.zig`.

### Links
- `Application/resources::App` → `Application/resources::registry, mailbox, device` · T · application-owned resources.
- `Application/resources::App` → `Application/fonts::SharedGridSet` · T · application-owned font sharing.
- `Application/fonts::SharedGridSet` → `Application/fonts::entries, library, discovery state` · T · shared-font infrastructure.
- `Application/fonts::entry` → `Application/fonts::SharedGrid` · T · stable allocated grid retained until reference count reaches zero.
- `Application/fonts::SharedGrid` → `Application/fonts::resolver, metrics, caches, atlases, lock` · T · shared CPU font data.
- `Session/core::app reference` → `Application/resources::App` · E · non-owning application reference.
- `Application/resources::registry` → `Application/boundary::runtime surfaces` · E · track registered surfaces.
- `Application/boundary::embedded runtime Surface` → `Session/core::Surface` · T · concrete embedded implementation stores `core_surface` by value.
- `Application/boundary::surface mailbox wrapper` → `Application/resources::mailbox` · E · enqueue an addressed envelope and wake runtime.
- `Application/boundary::App dispatch` → `Session/core::handleMessage` · E · deliver only while the surface remains registered.
- `Session/core::runtime references` → `Application/boundary::runtime services` · E · request UI actions, clipboard operations and closure.
- `Application/boundary::runtime callbacks` → `Interaction/dispatch::callbacks, Session/reconfigure::geometry callbacks` · E · deliver input and geometry changes.
- `Presentation/parts::font-grid message handler` → `Application/fonts::SharedGridSet` · E · release old grid only after installing its replacement.
- `Session/lifecycle::final cleanup` → `Application/fonts::SharedGridSet` · E · release Surface’s remaining grid reference.

# Summary

The plan uses five canvases: the current canvas, three child canvases and one application-level peer. Vertical expansion concentrates on interaction state, IO/emulator storage and presentation ownership. Horizontal expansion exposes asynchronous delivery, ownership transfer, locking and host boundaries without duplicating component interiors.

Verified at `ea8b12a8a9894b5259c441eadd8f6f0c65e215af`. Key corrections and qualifications:

- POSIX output has gather and parse workers; Windows retains a serial reader.
- Cursor, selection, charset and Kitty state belong to Screen, alongside PageList.
- Font replacement releases the old reference on renderer-thread acceptance.
- `queueIo()` filters Surface-originated writes, not every protocol-generated PTY reply.
- Rendering is gated and paced, not an unconditional wakeup → snapshot → draw chain; snapshot work can also mutate viewport/animation state.
- Termio resize sends an additional renderer notification after resizing.
- Runtime embedding can contain the core Surface; Surface’s references back to runtime objects do not imply ownership.
