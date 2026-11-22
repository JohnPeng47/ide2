    51	/// Create a renderer type with the provided graphics API wrapper.
    52	///
    53	/// The graphics API wrapper must provide the interface outlined below.
    54	/// Specific details for the interfaces are documented on the existing
    55	/// implementations (`Metal` and `OpenGL`).
    56	///
    57	/// Hierarchy of graphics abstractions:
    58	///
    59	/// [ GraphicsAPI ] - Responsible for configuring the runtime surface
    60	///    |     |        and providing render `Target`s that draw to it,
    61	///    |     |        as well as `Frame`s and `Pipeline`s.
    62	///    |     V
    63	///    | [ Target ] - Represents an abstract target for rendering, which
    64	///    |              could be a surface directly but is also used as an
    65	///    |              abstraction for off-screen frame buffers.
    66	///    V
    67	/// [ Frame ] - Represents the context for drawing a given frame,
    68	///    |        provides `RenderPass`es for issuing draw commands
    69	///    |        to, and reports the frame health when complete.
    70	///    V
    71	/// [ RenderPass ] - Represents a render pass in a frame, consisting of
    72	///   :              one or more `Step`s applied to the same target(s),
    73	/// [ Step ] - - - - each describing the input buffers and textures and
    74	///   :              the vertex/fragment functions and geometry to use.
    75	///   :_ _ _ _ _ _ _ _ _ _/
    76	///   v
    77	/// [ Pipeline ] - Describes a vertex and fragment function to be used
    78	///                for a `Step`; the `GraphicsAPI` is responsible for
    79	///                these and they should be constructed and cached
    80	///                ahead of time.
    81	///
    82	/// [ Buffer ] - An abstraction over a GPU buffer.
    83	///
    84	/// [ Texture ] - An abstraction over a GPU texture.
    85	///
    86	/// [ ExportedFrame ] - A finished frame ready to be consumed by the apprt
    87	///                     in case that the frame needs to be composited with
    88	///                     UI elements by the graphical toolkit manually.
    89	///
    90	pub fn Renderer(comptime GraphicsAPI: type) type {
    91	    return struct {
    92	        const Self = @This();
    93	
    94	        pub const API = GraphicsAPI;
    95	
    96	        pub const ExportedFrame = if (@hasDecl(GraphicsAPI, "ExportedFrame")) GraphicsAPI.ExportedFrame else void;
    97	
    98	        /// Whether +Y is down in the coordinate space of exported
    99	        /// frames. Apprts use this to orient frames when presenting.
   100	        pub const custom_shader_y_is_down = GraphicsAPI.custom_shader_y_is_down;
   101	
   102	        const Target = GraphicsAPI.Target;
   103	        const Buffer = GraphicsAPI.Buffer;
   104	        const Sampler = GraphicsAPI.Sampler;
   105	        const Texture = GraphicsAPI.Texture;
   106	        const RenderPass = GraphicsAPI.RenderPass;
   107	
   108	        const shaderpkg = GraphicsAPI.shaders;
   109	        const Shaders = shaderpkg.Shaders;
   110	
   111	        /// Allocator that can be used
   112	        alloc: std.mem.Allocator,
   113	
   114	        /// This mutex must be held whenever any state used in `drawFrame` is
   115	        /// being modified, and also when it's being accessed in `drawFrame`.
   116	        draw_mutex: std.Io.Mutex = .init,
   117	
   118	        /// The configuration we need derived from the main config.
   119	        config: DerivedConfig,
   120	
   121	        /// The mailbox for communicating with the window.
   122	        surface_mailbox: apprt.surface.Mailbox,
   123	
   124	        /// The latest exported frame ready to be consumed by an apprt
   125	        /// who needs to manually composite the frame with UI elements.
   126	        /// Previously exported frames are released when a new frame is
   127	        /// exported and pushed onto the queue.
   128	        ///
   129	        /// Unused if the renderer does not need to export frames to
   130	        /// present its rendered frame.
   131	        latest_frame: LatestFrame = .{},
   132	
   133	        /// Current font metrics defining our grid.
   134	        grid_metrics: font.Metrics,
   135	
   136	        /// The size of everything.
   137	        size: renderer.Size,
   138	
   139	        /// True if the window is focused
   140	        focused: bool,
   141	
   142	        /// True if the window is visible.
   143	        visible: bool,
   144	
   145	        /// Flag to indicate that our focus state changed for custom
   146	        /// shaders to update their state.
   147	        custom_shader_focused_changed: bool = false,
   148	
   149	        /// The most recent scrollbar state. We use this as a cache to
   150	        /// determine if we need to notify the apprt that there was a
   151	        /// scrollbar change.
   152	        scrollbar: terminal.Scrollbar,
   153	        scrollbar_dirty: bool,
   154	
   155	        /// Tracks the last bottom-right pin of the screen to detect new output.
   156	        /// When the final line changes (node or y differs), new content was added.
   157	        /// Used for scroll-to-bottom on output feature.
   158	        last_bottom_node: ?usize,
   159	        last_bottom_y: terminal.size.CellCountInt,
   160	
   161	        /// The most recent viewport matches so that we can render search
   162	        /// matches in the visible frame. This is provided asynchronously
   163	        /// from the search thread so we have the dirty flag to also note
   164	        /// if we need to rebuild our cells to include search highlights.
   165	        ///
   166	        /// Note that the selections MAY BE INVALID (point to PageList nodes
   167	        /// that do not exist anymore). These must be validated prior to use.
   168	        search_matches: ?renderer.Message.SearchMatches,
   169	        search_selected_match: ?renderer.Message.SearchMatch,
   170	        search_matches_dirty: bool,
   171	
   172	        /// The current set of cells to render. This is rebuilt on every frame
   173	        /// but we keep this around so that we don't reallocate. Each set of
   174	        /// cells goes into a separate shader.
   175	        cells: cellpkg.Contents,
   176	
   177	        /// Set to true after rebuildCells is called. This can be used
   178	        /// to determine if any possible changes have been made to the
   179	        /// cells for the draw call.
   180	        cells_rebuilt: bool = false,
   181	
   182	        /// Set to true after the Kitty image placements are rebuilt. Like
   183	        /// `cells_rebuilt`, this means the next frame must be drawn. This
   184	        /// matters when the images change but no cell does, for example
   185	        /// when a program places an image.
   186	        images_rebuilt: bool = false,
   187	
   188	        /// The current GPU uniform values.
   189	        uniforms: shaderpkg.Uniforms,
   190	
   191	        /// Custom shader uniform values.
   192	        custom_shader_uniforms: shadertoy.Uniforms,
   193	
   194	        /// Timestamp we rendered out first frame.
   195	        ///
   196	        /// This is used when updating custom shader uniforms.
   197	        first_frame_time: ?std.Io.Timestamp = null,
   198	
   199	        /// Timestamp when we rendered out more recent frame.
   200	        ///
   201	        /// This is used when updating custom shader uniforms.
   202	        last_frame_time: ?std.Io.Timestamp = null,
   203	
   204	        /// The font structures.
   205	        font_grid: *font.SharedGrid,
   206	        font_shaper: font.Shaper,
   207	        font_shaper_cache: font.ShaperCache,
   208	
   209	        /// The images that we may render.
   210	        images: ImageState = .empty,
   211	
   212	        /// Background image, if we have one.
   213	        bg_image: ?imagepkg.Image = null,
   214	        /// Set whenever the background image changes, signalling
   215	        /// that the new background image needs to be uploaded to
   216	        /// the GPU.
   217	        ///
   218	        /// This is initialized as true so that we load the image
   219	        /// on renderer initialization, not just on config change.
   220	        bg_image_changed: bool = true,
   221	        /// Background image vertex buffer.
   222	        bg_image_buffer: shaderpkg.BgImage,
   223	        /// This value is used to force-update the swap chain copy
   224	        /// of the background image buffer whenever we change it.
   225	        bg_image_buffer_modified: usize = 0,
   226	
   227	        /// Graphics API state.
   228	        api: GraphicsAPI,
   229	
   230	        /// The display link that paces drawing to the display's refresh
   231	        /// rate. It is created lazily on the render thread the first
   232	        /// time `syncDisplayLink` runs, and stays null if vsync is
   233	        /// disabled or creation failed. This is void on platforms
   234	        /// without a display link.
   235	        ///
   236	        /// The link is only ever started and stopped on the main thread.
   237	        /// See `renderer/DisplayLink.zig` for why that matters.
   238	        display_link: if (DisplayLink != void) ?*DisplayLink else void =
   239	            if (DisplayLink != void) null else {},
   240	
   241	        /// Health of the most recently completed frame.
   242	        health: std.atomic.Value(Health) = .{ .raw = .healthy },
   243	
   244	        /// Health of how well the apprt can present our frames.
   245	        ///
   246	        /// This is separate from `health` because a renderer
   247	        /// can produce healthy frames that the apprt can't present.
   248	        presentation_health: std.atomic.Value(Health) = .{ .raw = .healthy },
   249	
   250	        /// True when we have a graphics context that can create GPU
   251	        /// resources. Creating any GPU resource while this is false is invalid.
   252	        display_realized: bool = true,
   253	
   254	        /// Our swap chain (multiple buffering). Null when it has
   255	        /// been released, either because the surface is hidden
   256	        /// (`releaseGpuResources`) or because the display is
   257	        /// unrealized. Rebuilt on the next `drawFrame`.
   258	        swap_chain: ?SwapChain,
   259	
   260	        /// This value is used to force-update swap chain targets in the
   261	        /// event of a config change that requires it (such as blending mode).
   262	        target_config_modified: usize = 0,
   263	
   264	        /// If something happened that requires us to reinitialize our shaders,
   265	        /// this is set to true so that we can do that whenever possible.
   266	        reinitialize_shaders: bool = false,
   267	
   268	        /// Whether or not we have custom shaders.
   269	        has_custom_shaders: bool = false,
   270	
   271	        /// Our shader pipelines.
   272	        shaders: Shaders,
   273	
   274	        /// The render state we update per loop.
   275	        terminal_state: terminal.RenderState = .empty,
   276	
   277	        /// The number of frames since the last terminal state reset.
   278	        /// We reset the terminal state after ~100,000 frames (about 10 to
   279	        /// 15 minutes at 120Hz) to prevent wasted memory buildup from
   280	        /// a large screen.
   281	        terminal_state_frame_count: usize = 0,
   282	
   283	        /// Our overlay state, if any.
   284	        overlay: ?Overlay = null,
   285	
   286	        /// The base timestamp for the Kitty graphics animation clock.
   287	        /// Animation frame timing is expressed as milliseconds since
   288	        /// this instant. Set on the first frame update that observes
   289	        /// Kitty images.
   290	        kitty_animation_clock: ?std.Io.Timestamp = null,
   291	
   292	        /// When the next Kitty animation frame is due, in
   293	        /// milliseconds on the animation clock, from the most recent
   294	        /// frame update. Null when no running animation needs a
   295	        /// wakeup.
   296	        kitty_animation_next_ms: ?u64 = null,
   297	
   298	        const HighlightTag = enum(u8) {
   299	            search_match,
   300	            search_match_selected,
   301	        };
   302	        /// Swap chain which maintains multiple copies of the state needed to
   303	        /// render a frame, so that we can start building the next frame while
   304	        /// the previous frame is still being processed on the GPU.
   305	        const SwapChain = struct {
   306	            // The count of buffers we use for double/triple buffering.
   307	            // If this is one then we don't do any double+ buffering at all.
   308	            // This is comptime because there isn't a good reason to change
   309	            // this at runtime and there is a lot of complexity to support it.
   310	            const buf_count = GraphicsAPI.swap_chain_count;
   311	
   312	            /// `buf_count` structs that can hold the
   313	            /// data needed by the GPU to draw a frame.
   314	            frames: [buf_count]FrameState,
   315	            /// Index of the most recently used frame state struct.
   316	            frame_index: std.math.IntFittingRange(0, buf_count) = 0,
   317	            /// Semaphore that we wait on to make sure we have an available
   318	            /// frame state struct so we can start working on a new frame.
   319	            frame_sema: std.Io.Semaphore = .{ .permits = buf_count },
   320	
   321	            pub fn init(api: GraphicsAPI, custom_shaders: bool) !SwapChain {
   322	                var result: SwapChain = .{ .frames = undefined };
   323	
   324	                // Initialize all of our frame state.
   325	                for (&result.frames) |*frame| {
   326	                    frame.* = try FrameState.init(api, custom_shaders);
   327	                }
   328	
   329	                return result;
   330	            }
   331	
   332	            pub fn deinit(self: *SwapChain) void {
   333	                // Wait for all of our inflight draws to complete
   334	                // so that we can cleanly deinit our GPU state.
   335	                for (0..buf_count) |_| self.frame_sema.waitUncancelable(
   336	                    global.io(),
   337	                );
   338	                for (&self.frames) |*frame| frame.deinit();
   339	            }
   340	
   341	            /// Get the next frame state to draw to. This will wait on the
   342	            /// semaphore to ensure that the frame is available. This must
   343	            /// always be paired with a call to releaseFrame.
   344	            pub fn nextFrame(self: *SwapChain) *FrameState {
   345	                self.frame_sema.waitUncancelable(global.io());
   346	                self.frame_index = (self.frame_index + 1) % buf_count;
   347	                return &self.frames[self.frame_index];
   348	            }
   349	
   350	            /// This should be called when the frame has completed drawing.
   351	            pub fn releaseFrame(self: *SwapChain) void {
   352	                self.frame_sema.post(global.io());
   353	            }
   354	        };
   355	
   356	        /// State we need duplicated for every frame. Any state that could be
   357	        /// in a data race between the GPU and CPU while a frame is being drawn
   358	        /// should be in this struct.
   359	        ///
   360	        /// While a draw is in-process, we "lock" the state (via a semaphore)
   361	        /// and prevent the CPU from updating the state until our graphics API
   362	        /// reports that the frame is complete.
   363	        ///
   364	        /// This is used to implement double/triple buffering.
   365	        const FrameState = struct {
   366	            uniforms: UniformBuffer,
   367	            cells: CellTextBuffer,
   368	            cells_bg: CellBgBuffer,
   369	
   370	            grayscale: Texture,
   371	            grayscale_modified: usize = 0,
   372	            color: Texture,
   373	            color_modified: usize = 0,
   374	
   375	            target: Target,
   376	            /// See property of same name on Renderer for explanation.
   377	            target_config_modified: usize = 0,
   378	
   379	            /// Buffer with the vertex data for our background image.
   380	            ///
   381	            /// TODO: Make this an optional and only create it
   382	            ///       if we actually have a background image.
   383	            bg_image_buffer: BgImageBuffer,
   384	            /// See property of same name on Renderer for explanation.
   385	            bg_image_buffer_modified: usize = 0,
   386	
   387	            /// Custom shader state, this is null if we have no custom shaders.
   388	            custom_shader_state: ?CustomShaderState = null,
   389	
   390	            const UniformBuffer = Buffer(shaderpkg.Uniforms);
   391	            const CellBgBuffer = Buffer(shaderpkg.CellBg);
   392	            const CellTextBuffer = Buffer(shaderpkg.CellText);
   393	            const BgImageBuffer = Buffer(shaderpkg.BgImage);
   394	
   395	            pub fn init(api: GraphicsAPI, custom_shaders: bool) !FrameState {
   396	                // Uniform buffer contains exactly 1 uniform struct. The
   397	                // uniform data will be undefined so this must be set before
   398	                // a frame is drawn.
   399	                var uniforms = try UniformBuffer.init(api.uniformBufferOptions(), 1);
   400	                errdefer uniforms.deinit();
   401	
   402	                // Create GPU buffers for our cells.
   403	                //
   404	                // We start them off with a size of 1, which will of course be
   405	                // too small, but they will be resized as needed. This is a bit
   406	                // wasteful but since it's a one-time thing it's not really a
   407	                // huge concern.
   408	                var cells = try CellTextBuffer.init(api.fgBufferOptions(), 1);
   409	                errdefer cells.deinit();
   410	                var cells_bg = try CellBgBuffer.init(api.bgBufferOptions(), 1);
   411	                errdefer cells_bg.deinit();
   412	
   413	                // Create a GPU buffer for our background image info.
   414	                var bg_image_buffer = try BgImageBuffer.init(
   415	                    api.bgImageBufferOptions(),
   416	                    1,
   417	                );
   418	                errdefer bg_image_buffer.deinit();
   419	
   420	                // Initialize our textures for our font atlas.
   421	                //
   422	                // As with the buffers above, we start these off as small
   423	                // as possible since they'll inevitably be resized anyway.
   424	                const grayscale = try api.initAtlasTexture(&.{
   425	                    .data = undefined,
   426	                    .size = 1,
   427	                    .format = .grayscale,
   428	                });
   429	                errdefer grayscale.deinit();
   430	                const color = try api.initAtlasTexture(&.{
   431	                    .data = undefined,
   432	                    .size = 1,
   433	                    .format = .bgra,
   434	                });
   435	                errdefer color.deinit();
   436	
   437	                var custom_shader_state =
   438	                    if (custom_shaders)
   439	                        try CustomShaderState.init(api)
   440	                    else
   441	                        null;
   442	                errdefer if (custom_shader_state) |*state| state.deinit();
   443	
   444	                // Initialize the target. Just as with the other resources,
   445	                // start it off as small as we can since it'll be resized.
   446	                const target = try api.initTarget(1, 1);
   447	
   448	                return .{
   449	                    .uniforms = uniforms,
   450	                    .cells = cells,
   451	                    .cells_bg = cells_bg,
   452	                    .bg_image_buffer = bg_image_buffer,
   453	                    .grayscale = grayscale,
   454	                    .color = color,
   455	                    .target = target,
   456	                    .custom_shader_state = custom_shader_state,
   457	                };
   458	            }
   459	
   460	            pub fn deinit(self: *FrameState) void {
   461	                self.target.deinit();
   462	                self.uniforms.deinit();
   463	                self.cells.deinit();
   464	                self.cells_bg.deinit();
   465	                self.grayscale.deinit();
   466	                self.color.deinit();
   467	                self.bg_image_buffer.deinit();
   468	                if (self.custom_shader_state) |*state| state.deinit();
   469	            }
   470	
   471	            pub fn resize(
   472	                self: *FrameState,
   473	                api: GraphicsAPI,
   474	                width: usize,
   475	                height: usize,
   476	            ) !void {
   477	                if (self.custom_shader_state) |*state| {
   478	                    try state.resize(api, width, height);
   479	                }
   480	                const target = try api.initTarget(width, height);
   481	                self.target.deinit();
   482	                self.target = target;
   483	            }
   484	        };
   485	
   486	        /// State relevant to our custom shaders if we have any.
   487	        const CustomShaderState = struct {
   488	            /// When we have a custom shader state, we maintain a front
   489	            /// and back texture which we use as a swap chain to render
   490	            /// between when multiple custom shaders are defined.
   491	            front_texture: Texture,
   492	            back_texture: Texture,
   493	
   494	            /// Shadertoy uses a sampler for accessing the various channel
   495	            /// textures. In Metal, we need to explicitly create these since
   496	            /// the glslang-to-msl compiler doesn't do it for us (as we
   497	            /// normally would in hand-written MSL). To keep it clean and
   498	            /// consistent, we just force all rendering APIs to provide an
   499	            /// explicit sampler.
   500	            ///
   501	            /// Samplers are immutable and describe sampling properties so
   502	            /// we can share the sampler across front/back textures (although
   503	            /// we only need it for the source texture at a time, we don't
   504	            /// need to "swap" it).
   505	            sampler: Sampler,
   506	
   507	            uniforms: UniformBuffer,
   508	
   509	            const UniformBuffer = Buffer(shadertoy.Uniforms);
   510	
   511	            /// Swap the front and back textures.
   512	            pub fn swap(self: *CustomShaderState) void {
   513	                std.mem.swap(Texture, &self.front_texture, &self.back_texture);
   514	            }
   515	
   516	            pub fn init(api: GraphicsAPI) !CustomShaderState {
   517	                // Create a GPU buffer to hold our uniforms.
   518	                var uniforms = try UniformBuffer.init(api.uniformBufferOptions(), 1);
   519	                errdefer uniforms.deinit();
   520	
   521	                // Initialize the front and back textures at 1x1 px, this
   522	                // is slightly wasteful but it's only done once so whatever.
   523	                const front_texture = try Texture.init(
   524	                    api.textureOptions(),
   525	                    1,
   526	                    1,
   527	                    null,
   528	                );
   529	                errdefer front_texture.deinit();
   530	                const back_texture = try Texture.init(
   531	                    api.textureOptions(),
   532	                    1,
   533	                    1,
   534	                    null,
   535	                );
   536	                errdefer back_texture.deinit();
   537	
   538	                const sampler = try Sampler.init(api.samplerOptions());
   539	                errdefer sampler.deinit();
   540	
   541	                return .{
   542	                    .front_texture = front_texture,
   543	                    .back_texture = back_texture,
   544	                    .sampler = sampler,
   545	                    .uniforms = uniforms,
   546	                };
   547	            }
   548	
   549	            pub fn deinit(self: *CustomShaderState) void {
   550	                self.front_texture.deinit();
   551	                self.back_texture.deinit();
   552	                self.sampler.deinit();
   553	                self.uniforms.deinit();
   554	            }
   555	
   556	            pub fn resize(
   557	                self: *CustomShaderState,
   558	                api: GraphicsAPI,
   559	                width: usize,
   560	                height: usize,
   561	            ) !void {
   562	                const front_texture = try Texture.init(
   563	                    api.textureOptions(),
   564	                    @intCast(width),
   565	                    @intCast(height),
   566	                    null,
   567	                );
   568	                errdefer front_texture.deinit();
   569	                const back_texture = try Texture.init(
   570	                    api.textureOptions(),
   571	                    @intCast(width),
   572	                    @intCast(height),
   573	                    null,
   574	                );
   575	                errdefer back_texture.deinit();
   576	
   577	                self.front_texture.deinit();
   578	                self.back_texture.deinit();
   579	
   580	                self.front_texture = front_texture;
   581	                self.back_texture = back_texture;
   582	            }
   583	        };
   584	
   585	        /// The configuration for this renderer that is derived from the main
   586	        /// configuration. This must be exported so that we don't need to
   587	        /// pass around Config pointers which makes memory management a pain.
   588	        pub const DerivedConfig = struct {
   589	            arena: ArenaAllocator,
   590	
   591	            font_thicken: bool,
   592	            font_thicken_strength: u8,
   593	            font_features: std.ArrayList([:0]const u8),
   594	            font_styles: font.CodepointResolver.StyleStatus,
   595	            font_shaping_break: configpkg.FontShapingBreak,
   596	            cursor_color: ?configpkg.Config.TerminalColor,
   597	            cursor_opacity: f64,
   598	            cursor_text: ?configpkg.Config.TerminalColor,
   599	            background: terminal.color.RGB,
   600	            background_opacity: f64,
   601	            background_opacity_cells: bool,
   602	            foreground: terminal.color.RGB,
   603	            selection_background: ?configpkg.Config.TerminalColor,
   604	            selection_foreground: ?configpkg.Config.TerminalColor,
   605	            search_background: configpkg.Config.TerminalColor,
   606	            search_foreground: configpkg.Config.TerminalColor,
   607	            search_selected_background: configpkg.Config.TerminalColor,
   608	            search_selected_foreground: configpkg.Config.TerminalColor,
   609	            bold_color: ?terminal.Style.BoldColor,
   610	            faint_opacity: u8,
   611	            min_contrast: f32,
   612	            padding_color: configpkg.WindowPaddingColor,
   613	            custom_shaders: configpkg.RepeatablePath,
   614	            bg_image: ?configpkg.Path,
   615	            bg_image_opacity: f32,
   616	            bg_image_position: configpkg.BackgroundImagePosition,
   617	            bg_image_fit: configpkg.BackgroundImageFit,
   618	            bg_image_repeat: bool,
   619	            links: link.Set,
   620	            vsync: bool,
   621	            colorspace: configpkg.Config.WindowColorspace,
   622	            blending: configpkg.Config.AlphaBlending,
   623	            background_blur: configpkg.Config.BackgroundBlur,
   624	            scroll_to_bottom_on_output: bool,
   625	            custom_shader_animation: configpkg.CustomShaderAnimation,
   626	
   627	            pub fn init(
   628	                alloc_gpa: Allocator,
   629	                config: *const configpkg.Config,
   630	            ) !DerivedConfig {
   631	                var arena = ArenaAllocator.init(alloc_gpa);
   632	                errdefer arena.deinit();
   633	                const alloc = arena.allocator();
   634	
   635	                // Copy our shaders
   636	                const custom_shaders = try config.@"custom-shader".clone(alloc);
   637	
   638	                // Copy our background image
   639	                const bg_image =
   640	                    if (config.@"background-image") |bg|
   641	                        try bg.clone(alloc)
   642	                    else
   643	                        null;
   644	
   645	                // Copy our font features
   646	                const font_features = try config.@"font-feature".clone(alloc);
   647	
   648	                // Get our font styles
   649	                var font_styles = font.CodepointResolver.StyleStatus.initFill(true);
   650	                font_styles.set(.bold, config.@"font-style-bold" != .false);
   651	                font_styles.set(.italic, config.@"font-style-italic" != .false);
   652	                font_styles.set(.bold_italic, config.@"font-style-bold-italic" != .false);
   653	
   654	                // Our link configs
   655	                const links = try link.Set.fromConfig(
   656	                    alloc,
   657	                    config.link.links.items,
   658	                );
   659	
   660	                return .{
   661	                    .background_opacity = @max(0, @min(1, config.@"background-opacity")),
   662	                    .background_opacity_cells = config.@"background-opacity-cells",
   663	                    .font_thicken = config.@"font-thicken",
   664	                    .font_thicken_strength = config.@"font-thicken-strength",
   665	                    .font_features = font_features.list,
   666	                    .font_styles = font_styles,
   667	                    .font_shaping_break = config.@"font-shaping-break",
   668	
   669	                    .cursor_color = config.@"cursor-color",
   670	                    .cursor_text = config.@"cursor-text",
   671	                    .cursor_opacity = @max(0, @min(1, config.@"cursor-opacity")),
   672	
   673	                    .background = config.background.toTerminalRGB(),
   674	                    .foreground = config.foreground.toTerminalRGB(),
   675	                    .bold_color = if (config.@"bold-color") |b| b.toTerminal() else null,
   676	                    .faint_opacity = @intFromFloat(@ceil(config.@"faint-opacity" * 255)),
   677	
   678	                    .min_contrast = @floatCast(config.@"minimum-contrast"),
   679	                    .padding_color = config.@"window-padding-color",
   680	
   681	                    .selection_background = config.@"selection-background",
   682	                    .selection_foreground = config.@"selection-foreground",
   683	                    .search_background = config.@"search-background",
   684	                    .search_foreground = config.@"search-foreground",
   685	                    .search_selected_background = config.@"search-selected-background",
   686	                    .search_selected_foreground = config.@"search-selected-foreground",
   687	
   688	                    .custom_shaders = custom_shaders,
   689	                    .bg_image = bg_image,
   690	                    .bg_image_opacity = config.@"background-image-opacity",
   691	                    .bg_image_position = config.@"background-image-position",
   692	                    .bg_image_fit = config.@"background-image-fit",
   693	                    .bg_image_repeat = config.@"background-image-repeat",
   694	                    .links = links,
   695	                    .vsync = config.@"window-vsync",
   696	                    .colorspace = config.@"window-colorspace",
   697	                    .blending = config.@"alpha-blending",
   698	                    .background_blur = config.@"background-blur",
   699	                    .scroll_to_bottom_on_output = config.@"scroll-to-bottom".output,
   700	                    .custom_shader_animation = config.@"custom-shader-animation",
   701	                    .arena = arena,
   702	                };
   703	            }
   704	
   705	            pub fn deinit(self: *DerivedConfig) void {
   706	                const alloc = self.arena.allocator();
   707	                self.links.deinit(alloc);
   708	                self.arena.deinit();
   709	            }
   710	        };
   711	
   712	        pub fn init(alloc: Allocator, options: renderer.Options) !Self {
   713	            // Initialize our graphics API wrapper, this will prepare the
   714	            // surface provided by the apprt and set up any API- and surface-
   715	            // specific GPU resources.
   716	            var api = try GraphicsAPI.init(
   717	                alloc,
   718	                options.device,
   719	                options,
   720	            );
   721	            errdefer api.deinit();
   722	
   723	            const has_custom_shaders = options.config.custom_shaders.value.items.len > 0;
   724	
   725	            // Create the font shaper.
   726	            var font_shaper = try font.Shaper.init(alloc, .{
   727	                .features = options.config.font_features.items,
   728	            });
   729	            errdefer font_shaper.deinit();
   730	
   731	            // Initialize all the data that requires a critical font section.
   732	            const font_critical: struct {
   733	                metrics: font.Metrics,
   734	            } = font_critical: {
   735	                const grid: *font.SharedGrid = options.font_grid;
   736	                grid.lock.lockSharedUncancelable(global.io());
   737	                defer grid.lock.unlockShared(global.io());
   738	                break :font_critical .{
   739	                    .metrics = grid.metrics,
   740	                };
   741	            };
   742	
   743	            var result: Self = .{
   744	                .alloc = alloc,
   745	                .config = options.config,
   746	                .surface_mailbox = options.surface_mailbox,
   747	                .grid_metrics = font_critical.metrics,
   748	                .size = options.size,
   749	                .focused = true,
   750	                .visible = true,
   751	                .scrollbar = .zero,
   752	                .scrollbar_dirty = false,
   753	                .last_bottom_node = null,
   754	                .last_bottom_y = 0,
   755	                .search_matches = null,
   756	                .search_selected_match = null,
   757	                .search_matches_dirty = false,
   758	
   759	                // Render state
   760	                .cells = .{},
   761	                .uniforms = .{
   762	                    .projection_matrix = undefined,
   763	                    .cell_size = undefined,
   764	                    .grid_size = undefined,
   765	                    .grid_padding = undefined,
   766	                    .screen_size = undefined,
   767	                    .padding_extend = .{},
   768	                    .min_contrast = options.config.min_contrast,
   769	                    .cursor_pos = .{ std.math.maxInt(u16), std.math.maxInt(u16) },
   770	                    .cursor_color = undefined,
   771	                    .bg_color = .{
   772	                        options.config.background.r,
   773	                        options.config.background.g,
   774	                        options.config.background.b,
   775	                        // Note that if we're on macOS with glass effects
   776	                        // we'll disable background opacity but we handle
   777	                        // that in updateFrame.
   778	                        @intFromFloat(@round(options.config.background_opacity * 255.0)),
   779	                    },
   780	                    .bools = .{
   781	                        .cursor_wide = false,
   782	                        .use_display_p3 = options.config.colorspace == .@"display-p3",
   783	                        .use_linear_blending = options.config.blending.isLinear(),
   784	                        .use_linear_correction = options.config.blending == .@"linear-corrected",
   785	                    },
   786	                },
   787	                .custom_shader_uniforms = .{
   788	                    .resolution = .{ 0, 0, 1 },
   789	                    .time = 0,
   790	                    .time_delta = 0,
   791	                    .frame_rate = 60, // not currently updated
   792	                    .frame = 0,
   793	                    .channel_time = @splat(@splat(0)), // not currently updated
   794	                    .channel_resolution = @splat(@splat(0)),
   795	                    .mouse = @splat(0), // not currently updated
   796	                    .date = @splat(0), // not currently updated
   797	                    .sample_rate = 0, // N/A, we don't have any audio
   798	                    .current_cursor = @splat(0),
   799	                    .previous_cursor = @splat(0),
   800	                    .current_cursor_color = @splat(0),
   801	                    .previous_cursor_color = @splat(0),
   802	                    .current_cursor_style = 0,
   803	                    .previous_cursor_style = 0,
   804	                    .cursor_visible = 0,
   805	                    .cursor_change_time = 0,
   806	                    .time_focus = 0,
   807	                    .focus = 1, // assume focused initially
   808	                    .palette = @splat(@splat(0)),
   809	                    .background_color = @splat(0),
   810	                    .foreground_color = @splat(0),
   811	                    .cursor_color = @splat(0),
   812	                    .cursor_text = @splat(0),
   813	                    .selection_background_color = @splat(0),
   814	                    .selection_foreground_color = @splat(0),
   815	                },
   816	                .bg_image_buffer = undefined,
   817	
   818	                // Fonts
   819	                .font_grid = options.font_grid,
   820	                .font_shaper = font_shaper,
   821	                .font_shaper_cache = font.ShaperCache.init(),
   822	
   823	                // Graphics API stuff
   824	                .api = api,
   825	                .swap_chain = null,
   826	                .has_custom_shaders = has_custom_shaders,
   827	                .reinitialize_shaders = true,
   828	                // Shaders are initialized lazily on the render thread.
   829	                .shaders = .uninit,
   830	            };
   831	
   832	            // Ensure our undefined values above are correctly initialized.
   833	            result.updateFontGridUniforms();
   834	            result.updateScreenSizeUniforms();
   835	            result.updateBgImageBuffer();
   836	            try result.prepBackgroundImage();
   837	
   838	            return result;
   839	        }
   840	
   841	        pub fn deinit(self: *Self) void {
   842	            // This only deinitializes and frees CPU-side state
   843	            // and does not free GPU resources like the swap chain and
   844	            // shaders. Those are freed with `releaseGpuResources`.
   845	
   846	            if (self.overlay) |*overlay| overlay.deinit(self.alloc);
   847	            self.terminal_state.deinit(self.alloc);
   848	            if (self.search_selected_match) |*m| m.arena.deinit();
   849	            if (self.search_matches) |*m| m.arena.deinit();
   850	
   851	            self.latest_frame.deinit(global.io());
   852	
   853	            // Stop and release the display link. Surfaces are destroyed
   854	            // on the main thread, where `close` stops the link before
   855	            // returning. After this the display link callback is never
   856	            // invoked again, so `renderer.Thread` can free the `draw_now`
   857	            // handle the callback points at.
   858	            if (DisplayLink != void) {
   859	                if (self.display_link) |display_link| {
   860	                    display_link.close();
   861	                    self.display_link = null;
   862	                }
   863	            }
   864	
   865	            self.cells.deinit(self.alloc);
   866	
   867	            self.font_shaper.deinit();
   868	            self.font_shaper_cache.deinit(self.alloc);
   869	
   870	            self.config.deinit();
   871	            self.api.deinit();
   872	
   873	            self.* = undefined;
   874	        }
   875	
   876	        fn initShaders(self: *Self) !void {
   877	            var arena = ArenaAllocator.init(self.alloc);
   878	            defer arena.deinit();
   879	            const arena_alloc = arena.allocator();
   880	
   881	            // Load our custom shaders
   882	            const custom_shaders: []const [:0]const u8 = shadertoy.loadFromFiles(
   883	                arena_alloc,
   884	                self.config.custom_shaders,
   885	                GraphicsAPI.custom_shader_target,
   886	            ) catch |err| err: {
   887	                log.warn("error loading custom shaders err={}", .{err});
   888	                break :err &.{};
   889	            };
   890	
   891	            const has_custom_shaders = custom_shaders.len > 0;
   892	
   893	            var shaders = try self.api.initShaders(
   894	                self.alloc,
   895	                custom_shaders,
   896	            );
   897	            errdefer shaders.deinit(self.alloc);
   898	
   899	            self.shaders = shaders;
   900	            self.has_custom_shaders = has_custom_shaders;
   901	        }
   902	
   903	        /// Callback called by renderer.Thread when it begins.
   904	        pub fn threadEnter(self: *Self, surface: *apprt.Surface) !void {
   905	            // If our API has to do things on thread enter, let it.
   906	            if (@hasDecl(GraphicsAPI, "threadEnter")) {
   907	                try self.api.threadEnter(surface);
   908	            }
   909	        }
   910	
   911	        /// Callback called by renderer.Thread when it exits. Called on the
   912	        /// render thread. Releases all GPU resources before the API tears down
   913	        /// its context, since after this the GL context will be gone.
   914	        pub fn threadExit(self: *Self) void {
   915	            {
   916	                self.draw_mutex.lockUncancelable(global.io());
   917	                defer self.draw_mutex.unlock(global.io());
   918	
   919	                // Release swap chain and shaders. Shaders are only freed
   920	                // while unrealized and not every apprt unrealizes before
   921	                // destroying a surface (macOS never does), so mark it
   922	                // unrealized. This also stops any later draw.
   923	                self.display_realized = false;
   924	                self.releaseGpuResources();
   925	
   926	                // We don't release images in `releaseGpuResources`
   927	                // since it can be called whenever the terminal is
   928	                // occluded or unrealized, and we don't want to
   929	                // reupload images every time that happens.
   930	                self.images.deinit(self.alloc);
   931	                self.images = .empty;
   932	
   933	                if (self.bg_image) |img| {
   934	                    img.deinit(self.alloc);
   935	                    self.bg_image = null;
   936	                }
   937	            }
   938	
   939	            // If our API has to do things on thread exit, let it.
   940	            if (@hasDecl(GraphicsAPI, "threadExit")) {
   941	                self.api.threadExit();
   942	            }
   943	        }
   944	
   945	        /// Called by renderer.Thread when it starts the main loop.
   946	        pub fn loopEnter(self: *Self, thr: *renderer.Thread) !void {
   947	            // If our API has to do things on loop enter, let it.
   948	            if (@hasDecl(GraphicsAPI, "loopEnter")) {
   949	                self.api.loopEnter();
   950	            }
   951	
   952	            // If we don't support a display link we have no work to do.
   953	            if (comptime DisplayLink == void) return;
   954	
   955	            self.syncDisplayLink(null, &thr.draw_now);
   956	        }
   957	
   958	        /// Called by renderer.Thread when it exits the main loop.
   959	        pub fn loopExit(self: *Self) void {
   960	            // If our API has to do things on loop exit, let it.
   961	            if (@hasDecl(GraphicsAPI, "loopExit")) {
   962	                self.api.loopExit();
   963	            }
   964	
   965	            // If we don't support a display link we have no work to do.
   966	            if (comptime DisplayLink == void) return;
   967	
   968	            // Ask the display link to stop. The stop itself happens on
   969	            // the main thread shortly after. `deinit` later stops the
   970	            // link for certain before anything the display link callback
   971	            // references is freed.
   972	            const display_link = self.display_link orelse return;
   973	            display_link.setRunning(false);
   974	        }
   975	
   976	        /// This is called by the GTK apprt after the surface is
   977	        /// reinitialized (e.g. after the widget is re-realized following
   978	        /// a display change or reparenting).
   979	        pub fn displayRealized(self: *Self) !void {
   980	            // If our API has to do things on realize, let it.
   981	            if (@hasDecl(GraphicsAPI, "displayRealized")) {
   982	                self.api.displayRealized();
   983	            }
   984	
   985	            // Lock the draw mutex so that we can safely update state.
   986	            self.draw_mutex.lockUncancelable(global.io());
   987	            defer self.draw_mutex.unlock(global.io());
   988	
   989	            // Mark the display as realized. The render thread will lazily
   990	            // rebuild the swap chain and shaders on the next `drawFrame`,
   991	            // which is the right place for GL resource creation (it
   992	            // guarantees a current context on the render thread).
   993	            self.display_realized = true;
   994	            self.reinitialize_shaders = true;
   995	            self.target_config_modified = 1;
   996	        }
   997	
   998	        /// This is called when the surface is being unrealized.
   999	        /// This can happen because the surface is being closed but
  1000	        /// also when moving the window between displays or splitting.
  1001	        ///
  1002	        /// This runs on the main thread and only updates CPU-side state
  1003	        /// here; resource cleanup happens on the render thread via
  1004	        /// `releaseGpuResources`.
  1005	        pub fn displayUnrealized(self: *Self) void {
  1006	            // Lock the draw mutex so that we can safely update state.
  1007	            self.draw_mutex.lockUncancelable(global.io());
  1008	            defer self.draw_mutex.unlock(global.io());
  1009	
  1010	            // Clearing `display_realized` ensures drawFrame doesn't attempt
  1011	            // to rebuild the swap chain or make any graphics API calls.
  1012	            // The actual GPU resource release is done by the render thread.
  1013	            self.display_realized = false;
  1014	        }
  1015	
  1016	        /// A thread-safe, single-slot "latest wins" queue. The render thread
  1017	        /// calls `push` with the latest frame; the apprt calls `take` in its
  1018	        /// snapshot handler to grab the most recent frame. Old frames are
  1019	        /// dropped and released. For a terminal this is correct — we never
  1020	        /// want to queue up frames behind a slow compositor.
  1021	        const LatestFrame = struct {
  1022	            const Self = @This();
  1023	            mutex: std.Io.Mutex = .init,
  1024	            latest: ?ExportedFrame = null,
  1025	
  1026	            pub fn push(self: *LatestFrame, io: std.Io, value: ExportedFrame) void {
  1027	                if (comptime ExportedFrame == void) return;
  1028	
  1029	                self.mutex.lockUncancelable(io);
  1030	                defer self.mutex.unlock(io);
  1031	                if (self.latest) |*old| old.deinit();
  1032	                self.latest = value;
  1033	            }
  1034	
  1035	            pub fn take(self: *LatestFrame, io: std.Io) ?ExportedFrame {
  1036	                if (comptime ExportedFrame == void) return null;
  1037	
  1038	                self.mutex.lockUncancelable(io);
  1039	                defer self.mutex.unlock(io);
  1040	                const result = self.latest orelse return null;
  1041	                self.latest = null;
  1042	                return result;
  1043	            }
  1044	
  1045	            pub fn deinit(self: *LatestFrame, io: std.Io) void {
  1046	                if (comptime ExportedFrame == void) return;
  1047	
  1048	                self.mutex.lockUncancelable(io);
  1049	                defer self.mutex.unlock(io);
  1050	                if (self.latest) |*v| v.deinit();
  1051	                self.latest = null;
  1052	            }
  1053	        };
  1054	
  1055	        /// Push the latest completed frame, replacing if one previously
  1056	        /// existed. Called on the render thread.
  1057	        ///
  1058	        /// Has no effect for renderers that do not export frames
  1059	        /// (i.e. `ExportedFrame == void`).
  1060	        pub fn pushFrame(self: *Self, frame: ExportedFrame) void {
  1061	            return self.latest_frame.push(global.io(), frame);
  1062	        }
  1063	
  1064	        /// Take the latest completed frame for the apprt to composite.
  1065	        /// Returns null if no frame is available. The caller takes
  1066	        /// ownership of the returned frame. Called on the main thread.
  1067	        ///
  1068	        /// Has no effect for renderers that do not export frames
  1069	        /// (i.e. `ExportedFrame == void`).
  1070	        pub fn takeFrame(self: *Self) ?ExportedFrame {
  1071	            return self.latest_frame.take(global.io());
  1072	        }
  1073	
  1074	        /// The display link output callback. CoreVideo invokes this on
  1075	        /// its own thread once per display refresh while the link is
  1076	        /// running. All it does is wake the render thread, which then
  1077	        /// draws a frame.
  1078	        fn displayLinkCallback(
  1079	            _: *macos.video.DisplayLink,
  1080	            ud: ?*xev.Async,
  1081	        ) void {
  1082	            const draw_now = ud orelse return;
  1083	            draw_now.notify() catch |err| {
  1084	                log.err("error notifying draw_now err={}", .{err});
  1085	            };
  1086	        }
  1087	
  1088	        /// Mark the full screen as dirty so that we redraw everything.
  1089	        pub inline fn markDirty(self: *Self) void {
  1090	            self.terminal_state.dirty = .full;
  1091	        }
  1092	
  1093	        /// Called when the window moves to a different display, with
  1094	        /// the CGDirectDisplayID of the new one. The display link is
  1095	        /// bound to that display so that it follows its refresh rate.
  1096	        ///
  1097	        /// Must be called on the render thread.
  1098	        pub fn setMacOSDisplayID(
  1099	            self: *Self,
  1100	            id: u32,
  1101	            draw_now: *xev.Async,
  1102	        ) !void {
  1103	            if (comptime DisplayLink == void) return;
  1104	            self.syncDisplayLink(id, draw_now);
  1105	        }
  1106	
  1107	        /// The cadence of continuous (draw-only) animation wakes,
  1108	        /// i.e. 120fps, and the floor for any animation wake delay.
  1109	        pub const draw_interval_ms: u64 = 8;
  1110	
  1111	        /// A point in the future when the renderer needs to be driven
  1112	        /// again to keep animating, and what kind of drive it needs.
  1113	        pub const AnimationWake = struct {
  1114	            /// Delay in milliseconds until the wake is due.
  1115	            delay_ms: u64,
  1116	            kind: Kind,
  1117	
  1118	            pub const Kind = enum {
  1119	                /// A redraw alone suffices, no updateFrame. Much cheaper
  1120	                /// than `update`.
  1121	                draw,
  1122	
  1123	                /// Frame data must be updated first: updateFrame, then draw.
  1124	                update,
  1125	            };
  1126	        };
  1127	
  1128	        /// The soonest animation wake this renderer needs, if any:
  1129	        /// custom shader animation wants continuous draw-only wakes
  1130	        /// at draw_interval_ms while active, and a running Kitty
  1131	        /// graphics animation wants an update wake when its next
  1132	        /// frame is due. The renderer thread drives its animation
  1133	        /// timer off this, re-querying after every wake.
  1134	        ///
  1135	        /// Must be called on the render thread.
  1136	        pub fn animationWake(self: *const Self) ?AnimationWake {
  1137	            // Custom shaders animate by redrawing on a fixed cadence,
  1138	            // gated by configuration and focus.
  1139	            const shader_delay: ?u64 = shader: {
  1140	                if (!self.has_custom_shaders) break :shader null;
  1141	                break :shader switch (self.config.custom_shader_animation) {
  1142	                    .false => null,
  1143	                    .always => draw_interval_ms,
  1144	                    .true => if (self.focused) draw_interval_ms else null,
  1145	                };
  1146	            };
  1147	
  1148	            // Kitty animations tick during updateFrame; between
  1149	            // updates the deadline is absolute on the animation
  1150	            // clock, so a stream of draw wakes recomputing this
  1151	            // cannot starve it into the future.
  1152	            const kitty_delay: ?u64 = kitty: {
  1153	                const next = self.kitty_animation_next_ms orelse break :kitty null;
  1154	                const base = self.kitty_animation_clock orelse break :kitty null;
  1155	                const now: std.Io.Timestamp = .now(global.io(), .awake);
  1156	                const now_ms: u64 = @intCast(@divTrunc(
  1157	                    base.durationTo(now).nanoseconds,
  1158	                    std.time.ns_per_ms,
  1159	                ));
  1160	                // Never wake faster than the draw interval; an
  1161	                // overdue frame is picked up on the next wake.
  1162	                break :kitty @max(next -| now_ms, draw_interval_ms);
  1163	            };
  1164	
  1165	            // An update wake includes a draw, so it wins ties.
  1166	            if (kitty_delay) |k| {
  1167	                if (shader_delay == null or k <= shader_delay.?) {
  1168	                    return .{ .delay_ms = k, .kind = .update };
  1169	                }
  1170	            }
  1171	
  1172	            if (shader_delay) |s| return .{ .delay_ms = s, .kind = .draw };
  1173	
  1174	            return null;
  1175	        }
  1176	
  1177	        /// Returns true if the display link is running, meaning frames
  1178	        /// are paced by display refresh. In that case the render thread
  1179	        /// must only draw when the display link wakes it through
  1180	        /// `draw_now`, and not on its own.
  1181	        ///
  1182	        /// This reflects the link's actual state. Right after
  1183	        /// `syncDisplayLink` asks the link to start, this is still false
  1184	        /// until the main thread starts it, and the render thread draws
  1185	        /// immediately in the meantime.
  1186	        pub fn hasVsync(self: *const Self) bool {
  1187	            if (comptime DisplayLink == void) return false;
  1188	            const display_link = self.display_link orelse return false;
  1189	            return display_link.isRunning();
  1190	        }
  1191	
  1192	        /// Callback when the focus changes for the terminal this is rendering.
  1193	        ///
  1194	        /// Must be called on the render thread.
  1195	        pub fn setFocus(self: *Self, focus: bool) !void {
  1196	            assert(self.focused != focus);
  1197	
  1198	            self.focused = focus;
  1199	
  1200	            // Flag that we need to update our custom shaders
  1201	            self.custom_shader_focused_changed = true;
  1202	
  1203	            self.syncDisplayLink(null, null);
  1204	        }
  1205	
  1206	        /// Called when the apprt reports a change in how well
  1207	        /// frames can be presented.
  1208	        pub fn setPresentationHealth(self: *Self, health: Health) void {
  1209	            self.presentation_health.store(health, .seq_cst);
  1210	        }
  1211	
  1212	        /// Returns how well frames can be presented.
  1213	        pub fn presentationHealth(self: *Self) Health {
  1214	            return self.presentation_health.load(.seq_cst);
  1215	        }
  1216	
  1217	        /// Callback when the window is visible or occluded.
  1218	        ///
  1219	        /// Must be called on the render thread.
  1220	        pub fn setVisible(self: *Self, visible: bool) void {
  1221	            self.visible = visible;
  1222	            self.syncDisplayLink(null, null);
  1223	
  1224	            // When we're hidden, release our GPU resources.
  1225	            if (!visible) {
  1226	                self.draw_mutex.lockUncancelable(global.io());
  1227	                defer self.draw_mutex.unlock(global.io());
  1228	                self.releaseGpuResources();
  1229	            }
  1230	        }
  1231	
  1232	        /// Release the GPU resources we hold while the surface is not
  1233	        /// visible. Today this is the swap chain (render targets, font
  1234	        /// atlas texture copies, cell buffers, custom shader textures),
  1235	        /// which makes up nearly all of a surface's GPU memory usage.
  1236	        /// The swap chain is rebuilt on the next `drawFrame`.
  1237	        ///
  1238	        /// Note that images are NOT released here since we don't want
  1239	        /// to reupload images every time the terminal is brought back
  1240	        /// from being occluded or unrealized.
  1241	        ///
  1242	        /// Caller must lock the draw mutex before calling this function.
  1243	        /// Resources that are already released are skipped.
  1244	        pub fn releaseGpuResources(self: *Self) void {
  1245	            if (self.swap_chain) |*sc| {
  1246	                // Waits for any in-flight frames to complete, then
  1247	                // frees all GPU resources.
  1248	                sc.deinit();
  1249	                self.swap_chain = null;
  1250	            }
  1251	
  1252	            // Release the shaders as well if we're unrealized.
  1253	            if (!self.display_realized) {
  1254	                self.shaders.deinit(self.alloc);
  1255	            }
  1256	        }
  1257	
  1258	        /// Create the display link if needed, then ask it to match the
  1259	        /// current surface state: bound to `display_id` if one is given,
  1260	        /// and running only while the surface is visible and has
  1261	        /// something to draw (rebuilt cells or a running animation).
  1262	        ///
  1263	        /// `draw_now` is required the first time this is called, since
  1264	        /// creating the link needs the handle its callback will notify.
  1265	        /// Later calls can pass null.
  1266	        ///
  1267	        /// Must be called on the render thread. This never blocks. The
  1268	        /// display link applies the requested state on the main thread
  1269	        /// shortly after, because starting and stopping a CVDisplayLink
  1270	        /// anywhere else can deadlock against CoreVideo's own display
  1271	        /// reconfiguration handling. See `renderer/DisplayLink.zig`
  1272	        /// for the full explanation.
  1273	        fn syncDisplayLink(
  1274	            self: *Self,
  1275	            display_id: ?u32,
  1276	            draw_now: ?*xev.Async,
  1277	        ) void {
  1278	            if (comptime DisplayLink == void) return;
  1279	
  1280	            const display_link = self.display_link orelse display_link: {
  1281	                if (!self.config.vsync) return;
  1282	                const callback = draw_now orelse return;
  1283	                const result = DisplayLink.create(
  1284	                    self.alloc,
  1285	                    xev.Async,
  1286	                    &displayLinkCallback,
  1287	                    callback,
  1288	                ) catch |err| {
  1289	                    // A locked macOS session can temporarily have no active
  1290	                    // displays. Rendering continues without vsync and the
  1291	                    // next call to this function tries again.
  1292	                    log.warn("error creating display link; using fallback rendering err={}", .{err});
  1293	                    return;
  1294	                };
  1295	
  1296	                self.display_link = result;
  1297	                log.info("created display link", .{});
  1298	                break :display_link result;
  1299	            };
  1300	
  1301	            if (display_id) |id| display_link.setDisplay(id);
  1302	
  1303	            const should_run =
  1304	                // Non-visible windows never vsync
  1305	                self.visible and
  1306	                // Only vsync if we have cell or image changes or animation
  1307	                (self.cells_rebuilt or
  1308	                    self.images_rebuilt or
  1309	                    self.animationWake() != null);
  1310	
  1311	            display_link.setRunning(should_run);
  1312	        }
  1313	
  1314	        /// Set the new font grid.
  1315	        ///
  1316	        /// Must be called on the render thread.
  1317	        pub fn setFontGrid(self: *Self, grid: *font.SharedGrid) void {
  1318	            self.draw_mutex.lockUncancelable(global.io());
  1319	            defer self.draw_mutex.unlock(global.io());
  1320	
  1321	            // Update our grid
  1322	            self.font_grid = grid;
  1323	
  1324	            // Update all our textures so that they sync on the next frame.
  1325	            // We can modify this without a lock because the GPU does not
  1326	            // touch this data. A released swap chain is rebuilt with
  1327	            // fresh frames that sync all textures on first use.
  1328	            if (self.swap_chain) |*sc| for (&sc.frames) |*frame| {
  1329	                frame.grayscale_modified = 0;
  1330	                frame.color_modified = 0;
  1331	            };
  1332	
  1333	            // Get our metrics from the grid. This doesn't require a lock because
  1334	            // the metrics are never recalculated.
  1335	            const metrics = grid.metrics;
  1336	            self.grid_metrics = metrics;
  1337	
  1338	            // Reset our shaper cache. If our font changed (not just the size) then
  1339	            // the data in the shaper cache may be invalid and cannot be used, so we
  1340	            // always clear the cache just in case.
  1341	            const font_shaper_cache = font.ShaperCache.init();
  1342	            self.font_shaper_cache.deinit(self.alloc);
  1343	            self.font_shaper_cache = font_shaper_cache;
  1344	
  1345	            // Update cell size.
  1346	            self.size.cell = .{
  1347	                .width = metrics.cell_width,
  1348	                .height = metrics.cell_height,
  1349	            };
  1350	
  1351	            // Update relevant uniforms
  1352	            self.updateFontGridUniforms();
  1353	
  1354	            // Force a full rebuild, because cached rows may still reference
  1355	            // an outdated atlas from the old grid and this can cause garbage
  1356	            // to be rendered.
  1357	            self.markDirty();
  1358	        }
  1359	
  1360	        /// Update uniforms that are based on the font grid.
  1361	        ///
  1362	        /// Caller must hold the draw mutex.
  1363	        fn updateFontGridUniforms(self: *Self) void {
  1364	            self.uniforms.cell_size = .{
  1365	                @floatFromInt(self.grid_metrics.cell_width),
  1366	                @floatFromInt(self.grid_metrics.cell_height),
  1367	            };
  1368	        }
  1369	
  1370	        /// Update the frame data.
  1371	        pub fn updateFrame(
  1372	            self: *Self,
  1373	            state: *renderer.State,
  1374	            cursor_blink_visible: bool,
  1375	        ) Allocator.Error!void {
  1376	            // CoreText shaping accumulates objects for deferred release over
  1377	            // the course of a frame. Always flush those objects, including
  1378	            // when rebuilding the frame fails due to memory pressure.
  1379	            defer self.font_shaper.endFrame();
  1380	
  1381	            // We fully deinit and reset the terminal state every so often
  1382	            // so that a particularly large terminal state doesn't cause
  1383	            // the renderer to hold on to retained memory.
  1384	            //
  1385	            // Frame count is ~12 minutes at 120Hz.
  1386	            const max_terminal_state_frame_count = 100_000;
  1387	            if (self.terminal_state_frame_count >= max_terminal_state_frame_count) {
  1388	                self.terminal_state.deinit(self.alloc);
  1389	                self.terminal_state = .empty;
  1390	                self.terminal_state_frame_count = 0;
  1391	            }
  1392	            self.terminal_state_frame_count += 1;
  1393	
  1394	            // Create an arena for all our temporary allocations while rebuilding
  1395	            var arena = ArenaAllocator.init(self.alloc);
  1396	            defer arena.deinit();
  1397	            const arena_alloc = arena.allocator();
  1398	
  1399	            // Data we extract out of the critical area.
  1400	            const Critical = struct {
  1401	                links: terminal.RenderState.CellSet,
  1402	                mouse: renderer.State.Mouse,
  1403	                preedit: ?renderer.State.Preedit,
  1404	                scrollbar: terminal.Scrollbar,
  1405	                overlay_features: []const Overlay.Feature,
  1406	            };
  1407	
  1408	            // Update all our data as tightly as possible within the mutex.
  1409	            var critical: Critical = critical: {
  1410	                // NOTE: This code needs be updated to 0.16.0 before you
  1411	                // un-comment it ;)
  1412	                //
  1413	                // const start = try std.time.Instant.now();
  1414	                // const start_micro = std.time.microTimestamp();
  1415	                // defer {
  1416	                //     const end = std.time.Instant.now() catch unreachable;
  1417	                //     std.log.err("[updateFrame critical time] start={}\tduration={} us", .{ start_micro, end.since(start) / std.time.ns_per_us });
  1418	                // }
  1419	
  1420	                state.lockDemand(global.io());
  1421	                defer state.unlockDemand(global.io());
  1422	
  1423	                // If we're in a synchronized output state, we pause all rendering.
  1424	                if (state.terminal.modes.get(.synchronized_output)) {
  1425	                    log.debug("synchronized output started, skipping render", .{});
  1426	                    return;
  1427	                }
  1428	
  1429	                // If scroll-to-bottom on output is enabled, check if the final line
  1430	                // changed by comparing the bottom-right pin. If the node pointer or
  1431	                // y offset changed, new content was added to the screen.
  1432	                // Update this BEFORE we update our render state so we can
  1433	                // draw the new scrolled data immediately.
  1434	                if (self.config.scroll_to_bottom_on_output) scroll: {
  1435	                    const br = state.terminal.screens.active.pages.getBottomRight(.screen) orelse break :scroll;
  1436	
  1437	                    // If the pin hasn't changed, then don't scroll.
  1438	                    if (self.last_bottom_node == @intFromPtr(br.node) and
  1439	                        self.last_bottom_y == br.y) break :scroll;
  1440	
  1441	                    // Update tracked pin state for next frame
  1442	                    self.last_bottom_node = @intFromPtr(br.node);
  1443	                    self.last_bottom_y = br.y;
  1444	
  1445	                    // Scroll
  1446	                    state.terminal.scrollViewport(.bottom);
  1447	                }
  1448	
  1449	                // Advance any running Kitty graphics animations to the
  1450	                // frame due now, and remember when the next frame is
  1451	                // due (as an absolute deadline, see animationWake) so
  1452	                // the renderer thread can schedule a wakeup for it.
  1453	                //
  1454	                // This runs before the render state update. Advancing
  1455	                // a frame gives the image a new generation, so the
  1456	                // update then reports placements with the new frame,
  1457	                // and the frame is uploaded and drawn right away.
  1458	                self.kitty_animation_next_ms = next: {
  1459	                    // Likely case: we have no kitty images, so do nothing.
  1460	                    const storage = &state.terminal.screens.active.kitty_images;
  1461	                    if (storage.images.count() == 0) break :next null;
  1462	
  1463	                    const now: std.Io.Timestamp = .now(global.io(), .awake);
  1464	                    const base = self.kitty_animation_clock orelse base: {
  1465	                        self.kitty_animation_clock = now;
  1466	                        break :base now;
  1467	                    };
  1468	                    const now_ms: u64 = @intCast(@divTrunc(
  1469	                        base.durationTo(now).nanoseconds,
  1470	                        std.time.ns_per_ms,
  1471	                    ));
  1472	                    const delay = storage.animationTick(
  1473	                        global.io(),
  1474	                        now_ms,
  1475	                    ) orelse break :next null;
  1476	                    break :next now_ms + delay;
  1477	                };
  1478	
  1479	                // Begin the update of our terminal state. Work that
  1480	                // doesn't require terminal access (e.g. style
  1481	                // denormalization) is deferred to the endUpdate call
  1482	                // outside of this critical section, keeping our lock
  1483	                // hold time as short as possible.
  1484	                try self.terminal_state.beginUpdate(
  1485	                    self.alloc,
  1486	                    state.terminal,
  1487	                );
  1488	
  1489	                // If our terminal state is dirty at all we need to redo
  1490	                // the viewport search.
  1491	                if (self.terminal_state.dirty != .false) {
  1492	                    state.terminal.flags.search_viewport_dirty = true;
  1493	                }
  1494	
  1495	                // Get our scrollbar out of the terminal. We synchronize
  1496	                // the scrollbar read with frame data updates because this
  1497	                // naturally limits the number of calls to this method (it
  1498	                // can be expensive) and also makes it so we don't need another
  1499	                // cross-thread mailbox message within the IO path.
  1500	                const scrollbar = state.terminal.screens.active.pages.scrollbar();
  1501	
  1502	                // Get our preedit state
  1503	                const preedit: ?renderer.State.Preedit = preedit: {
  1504	                    const p = state.preedit orelse break :preedit null;
  1505	                    break :preedit try p.clone(arena_alloc);
  1506	                };
  1507	
  1508	                // Rebuild our Kitty image placements when the placements
  1509	                // or the images changed. The render state update above
  1510	                // has already positioned every placement, so this is
  1511	                // cheap. Most frames that only change text skip it.
  1512	                if (self.images.kittyRequiresUpdate(
  1513	                    state.terminal,
  1514	                    &self.terminal_state,
  1515	                )) {
  1516	                    // We need to grab the draw mutex since this updates
  1517	                    // our image state that drawFrame uses.
  1518	                    self.draw_mutex.lockUncancelable(global.io());
  1519	                    defer self.draw_mutex.unlock(global.io());
  1520	                    self.images.kittyUpdate(
  1521	                        self.alloc,
  1522	                        state.terminal,
  1523	                        &self.terminal_state,
  1524	                    );
  1525	                    self.images_rebuilt = true;
  1526	                }
  1527	
  1528	                // Get our OSC8 links we're hovering if we have a mouse.
  1529	                // This requires terminal state because of URLs.
  1530	                const links: terminal.RenderState.CellSet = osc8: {
  1531	                    // If our mouse isn't hovering, we have no links.
  1532	                    const vp = state.mouse.point orelse break :osc8 .empty;
  1533	
  1534	                    // If the right mods aren't pressed, then we can't match.
  1535	                    if (!state.mouse.mods.equal(inputpkg.ctrlOrSuper(.{})))
  1536	                        break :osc8 .empty;
  1537	
  1538	                    break :osc8 self.terminal_state.linkCells(
  1539	                        arena_alloc,
  1540	                        vp,
  1541	                    ) catch |err| {
  1542	                        log.warn("error searching for OSC8 links err={}", .{err});
  1543	                        break :osc8 .empty;
  1544	                    };
  1545	                };
  1546	
  1547	                const overlay_features: []const Overlay.Feature = overlay: {
  1548	                    const insp = state.inspector orelse break :overlay &.{};
  1549	                    const renderer_info = insp.rendererInfo();
  1550	                    break :overlay renderer_info.overlayFeatures(
  1551	                        arena_alloc,
  1552	                    ) catch &.{};
  1553	                };
  1554	
  1555	                break :critical .{
  1556	                    .links = links,
  1557	                    .mouse = state.mouse,
  1558	                    .preedit = preedit,
  1559	                    .scrollbar = scrollbar,
  1560	                    .overlay_features = overlay_features,
  1561	                };
  1562	            };
  1563	
  1564	            // Outside the critical area, complete the update we began
  1565	            // within it. This must be done before anything reads the
  1566	            // render state (e.g. rebuildCells).
  1567	            self.terminal_state.endUpdate();
  1568	
  1569	            // Outside the critical area we can update our links to contain
  1570	            // our regex results.
  1571	            self.config.links.renderCellMap(
  1572	                arena_alloc,
  1573	                &critical.links,
  1574	                &self.terminal_state,
  1575	                state.mouse.point,
  1576	                state.mouse.mods,
  1577	            ) catch |err| {
  1578	                log.warn("error searching for regex links err={}", .{err});
  1579	            };
  1580	
  1581	            // Clear our highlight state and update.
  1582	            if (self.search_matches_dirty or self.terminal_state.dirty != .false) {
  1583	                self.search_matches_dirty = false;
  1584	
  1585	                // Clear the prior highlights
  1586	                const row_data = self.terminal_state.row_data.slice();
  1587	                var any_dirty: bool = false;
  1588	                for (
  1589	                    row_data.items(.highlights),
  1590	                    row_data.items(.dirty),
  1591	                ) |*highlights, *dirty| {
  1592	                    if (highlights.items.len > 0) {
  1593	                        highlights.clearRetainingCapacity();
  1594	                        dirty.* = true;
  1595	                        any_dirty = true;
  1596	                    }
  1597	                }
  1598	                if (any_dirty and self.terminal_state.dirty == .false) {
  1599	                    self.terminal_state.dirty = .partial;
  1600	                }
  1601	
  1602	                // NOTE: The order below matters. Highlights added earlier
  1603	                // will take priority.
  1604	
  1605	                if (self.search_selected_match) |m| {
  1606	                    self.terminal_state.updateHighlightsFlattened(
  1607	                        self.alloc,
  1608	                        @backingInt(HighlightTag.search_match_selected),
  1609	                        &.{m.match},
  1610	                    ) catch |err| {
  1611	                        // Not a critical error, we just won't show highlights.
  1612	                        log.warn("error updating search selected highlight err={}", .{err});
  1613	                    };
  1614	                }
  1615	
  1616	                if (self.search_matches) |m| {
  1617	                    self.terminal_state.updateHighlightsFlattened(
  1618	                        self.alloc,
  1619	                        @backingInt(HighlightTag.search_match),
  1620	                        m.matches,
  1621	                    ) catch |err| {
  1622	                        // Not a critical error, we just won't show highlights.
  1623	                        log.warn("error updating search highlights err={}", .{err});
  1624	                    };
  1625	                }
  1626	            }
  1627	
  1628	            // From this point forward no more errors.
  1629	            errdefer comptime unreachable;
  1630	
  1631	            // Reset our dirty state after updating.
  1632	            defer self.terminal_state.dirty = .false;
  1633	
  1634	            // Rebuild the overlay image if we have one. We can do this
  1635	            // outside of any critical areas.
  1636	            self.rebuildOverlay(
  1637	                critical.overlay_features,
  1638	            ) catch |err| {
  1639	                log.warn(
  1640	                    "error rebuilding overlay surface err={}",
  1641	                    .{err},
  1642	                );
  1643	            };
  1644	
  1645	            // Acquire the draw mutex for all remaining state updates.
  1646	            {
  1647	                self.draw_mutex.lockUncancelable(global.io());
  1648	                defer self.draw_mutex.unlock(global.io());
  1649	
  1650	                // Build our GPU cells
  1651	                self.rebuildCells(
  1652	                    critical.preedit,
  1653	                    renderer.cursorStyle(&self.terminal_state, .{
  1654	                        .preedit = critical.preedit != null,
  1655	                        .focused = self.focused,
  1656	                        .blink_visible = cursor_blink_visible,
  1657	                    }),
  1658	                    &critical.links,
  1659	                ) catch |err| {
  1660	                    // This means we weren't able to allocate our buffer
  1661	                    // to update the cells. In this case, we continue with
  1662	                    // our old buffer (frozen contents) and log it.
  1663	                    comptime assert(@TypeOf(err) == error{OutOfMemory});
  1664	                    log.warn("error rebuilding GPU cells err={}", .{err});
  1665	                };
  1666	
  1667	                // The scrollbar is only emitted during draws so we also
  1668	                // check the scrollbar cache here and update if needed.
  1669	                // This is pretty fast.
  1670	                if (!self.scrollbar.eql(critical.scrollbar)) {
  1671	                    self.scrollbar = critical.scrollbar;
  1672	                    self.scrollbar_dirty = true;
  1673	                }
  1674	
  1675	                // Update our background color
  1676	                self.uniforms.bg_color = .{
  1677	                    self.terminal_state.colors.background.r,
  1678	                    self.terminal_state.colors.background.g,
  1679	                    self.terminal_state.colors.background.b,
  1680	                    @intFromFloat(@round(self.config.background_opacity * 255.0)),
  1681	                };
  1682	
  1683	                // If we're on macOS and have glass styles, we remove
  1684	                // the background opacity because the glass effect handles
  1685	                // it.
  1686	                if (comptime builtin.target.os.tag == .macos) switch (self.config.background_blur) {
  1687	                    .@"macos-glass-regular",
  1688	                    .@"macos-glass-clear",
  1689	                    => self.uniforms.bg_color[3] = 0,
  1690	
  1691	                    else => {},
  1692	                };
  1693	
  1694	                // Prepare our overlay image for upload (or unload). This
  1695	                // has to use our general allocator since it modifies
  1696	                // state that survives frames.
  1697	                self.images.overlayUpdate(
  1698	                    self.alloc,
  1699	                    self.overlay,
  1700	                ) catch |err| {
  1701	                    log.warn("error updating overlay images err={}", .{err});
  1702	                };
  1703	
  1704	                // Update custom shader uniforms that depend on terminal state.
  1705	                self.updateCustomShaderUniformsFromState();
  1706	            }
  1707	
  1708	            // Start the display link now that the rebuilt frame is ready.
  1709	            self.syncDisplayLink(null, null);
  1710	        }
  1711	
  1712	        /// Draw the frame to the screen.
  1713	        ///
  1714	        /// If `sync` is true, this will synchronously block until
  1715	        /// the frame is finished drawing and has been presented.
  1716	        pub fn drawFrame(
  1717	            self: *Self,
  1718	            sync: bool,
  1719	        ) !void {
  1720	            // Everything that touches draw state happens under the draw
  1721	            // mutex. The display link is synced after the mutex is
  1722	            // released. It doesn't need the lock, and this keeps the
  1723	            // critical section to just drawing.
  1724	            const sync_display_link = locked: {
  1725	                self.draw_mutex.lockUncancelable(global.io());
  1726	                defer self.draw_mutex.unlock(global.io());
  1727	                break :locked try self.drawFrameLocked(sync);
  1728	            };
  1729	
  1730	            if (sync_display_link) self.syncDisplayLink(null, null);
  1731	        }
  1732	
  1733	        /// The body of `drawFrame`. Must be called with `draw_mutex` held.
  1734	        ///
  1735	        /// Returns true if the display link should be resynced once the
  1736	        /// draw mutex is released. This is only ever true on the no-redraw
  1737	        /// path, which a sync draw never takes. Sync draws come from the
  1738	        /// main thread, so this keeps `syncDisplayLink` on the render
  1739	        /// thread as its contract requires.
  1740	        fn drawFrameLocked(
  1741	            self: *Self,
  1742	            sync: bool,
  1743	        ) !bool {
  1744	            // After the graphics API is complete (so we defer) we want to
  1745	            // update our scrollbar state.
  1746	            defer if (self.scrollbar_dirty) {
  1747	                // Fail instantly if the surface mailbox if full, we'll just
  1748	                // get it on the next frame.
  1749	                if (self.surface_mailbox.push(.{
  1750	                    .scrollbar = self.scrollbar,
  1751	                }, .instant) > 0) self.scrollbar_dirty = false;
  1752	            };
  1753	
  1754	            // Let our graphics API do any bookkeeping, etc.
  1755	            // that it needs to do before / after `drawFrame`.
  1756	            self.api.drawFrameStart();
  1757	            defer self.api.drawFrameEnd();
  1758	
  1759	            // Retrieve the most up-to-date surface size from the Graphics API
  1760	            const surface_size = try self.api.surfaceSize();
  1761	
  1762	            // If either of our surface dimensions is zero
  1763	            // then drawing is absurd, so we just return.
  1764	            if (surface_size.width == 0 or surface_size.height == 0) return false;
  1765	
  1766	            // If we have no graphics context we can't draw. This is
  1767	            // only the case while unrealized (GTK) or after the render
  1768	            // thread exits; displayRealized rebuilds the swap chain.
  1769	            if (!self.display_realized) return false;
  1770	
  1771	            // Get our swap chain, rebuilding it if it was released
  1772	            // while we were hidden. Rebuilding is deferred to draw
  1773	            // time because resource creation must happen somewhere
  1774	            // our graphics API allows it (OpenGL requires a current
  1775	            // context, which drawFrame guarantees).
  1776	            const swap_chain: *SwapChain, const swap_chain_rebuilt: bool =
  1777	                if (self.swap_chain) |*sc| .{ sc, false } else rebuild: {
  1778	                    self.swap_chain = try SwapChain.init(
  1779	                        self.api,
  1780	                        self.has_custom_shaders,
  1781	                    );
  1782	                    break :rebuild .{ &self.swap_chain.?, true };
  1783	                };
  1784	
  1785	            const size_changed =
  1786	                self.size.screen.width != surface_size.width or
  1787	                self.size.screen.height != surface_size.height;
  1788	
  1789	            // Conditions under which we need to draw the frame, otherwise we
  1790	            // don't need to since the previous frame should be identical.
  1791	            //
  1792	            // While any animation is in progress (a pending animation wake)
  1793	            // every draw must actually render.
  1794	            const needs_redraw =
  1795	                size_changed or
  1796	                swap_chain_rebuilt or
  1797	                self.cells_rebuilt or
  1798	                self.images_rebuilt or
  1799	                self.animationWake() != null or
  1800	                sync;
  1801	
  1802	            if (!needs_redraw) {
  1803	                // Ask our caller to resync the display link once the draw
  1804	                // mutex is released, because we can probably pause the
  1805	                // display link at this point.
  1806	                return true;
  1807	            }
  1808	            self.cells_rebuilt = false;
  1809	            self.images_rebuilt = false;
  1810	
  1811	            // Wait for a frame to be available.
  1812	            const frame = swap_chain.nextFrame();
  1813	            errdefer swap_chain.releaseFrame();
  1814	            // log.debug("drawing frame index={}", .{swap_chain.frame_index});
  1815	
  1816	            // If we need to reinitialize our shaders, do so.
  1817	            if (self.reinitialize_shaders) {
  1818	                self.reinitialize_shaders = false;
  1819	                self.shaders.deinit(self.alloc);
  1820	                try self.initShaders();
  1821	            }
  1822	
  1823	            // Our shaders should not be defunct at this point.
  1824	            assert(!self.shaders.defunct);
  1825	
  1826	            // If we have custom shaders, make sure we have the
  1827	            // custom shader state in our frame state, otherwise
  1828	            // if we have a state but don't need it we remove it.
  1829	            if (self.has_custom_shaders) {
  1830	                if (frame.custom_shader_state == null) {
  1831	                    frame.custom_shader_state = try .init(self.api);
  1832	                    try frame.custom_shader_state.?.resize(
  1833	                        self.api,
  1834	                        surface_size.width,
  1835	                        surface_size.height,
  1836	                    );
  1837	                }
  1838	            } else if (frame.custom_shader_state) |*state| {
  1839	                state.deinit();
  1840	                frame.custom_shader_state = null;
  1841	            }
  1842	
  1843	            // If our stored size doesn't match the
  1844	            // surface size we need to update it.
  1845	            if (size_changed) {
  1846	                self.size.screen = .{
  1847	                    .width = surface_size.width,
  1848	                    .height = surface_size.height,
  1849	                };
  1850	                self.updateScreenSizeUniforms();
  1851	            }
  1852	
  1853	            // If this frame's target isn't the correct size, or the target
  1854	            // config has changed (such as when the blending mode changes),
  1855	            // remove it and replace it with a new one with the right values.
  1856	            if (frame.target.width != self.size.screen.width or
  1857	                frame.target.height != self.size.screen.height or
  1858	                frame.target_config_modified != self.target_config_modified)
  1859	            {
  1860	                try frame.resize(
  1861	                    self.api,
  1862	                    self.size.screen.width,
  1863	                    self.size.screen.height,
  1864	                );
  1865	                frame.target_config_modified = self.target_config_modified;
  1866	            }
  1867	
  1868	            // Upload images to the GPU as necessary.
  1869	            _ = self.images.upload(self.alloc, &self.api);
  1870	
  1871	            // Upload the background image to the GPU as necessary.
  1872	            try self.uploadBackgroundImage();
  1873	
  1874	            // Update per-frame custom shader uniforms.
  1875	            try self.updateCustomShaderUniformsForFrame();
  1876	
  1877	            // Setup our frame data
  1878	            try frame.uniforms.sync(&.{self.uniforms});
  1879	            try frame.cells_bg.sync(self.cells.bg_cells);
  1880	            const fg_count = try frame.cells.syncFromArrayLists(self.cells.fg_rows);
  1881	
  1882	            // If our background image buffer has changed, sync it.
  1883	            if (frame.bg_image_buffer_modified != self.bg_image_buffer_modified) {
  1884	                try frame.bg_image_buffer.sync(&.{self.bg_image_buffer});
  1885	
  1886	                frame.bg_image_buffer_modified = self.bg_image_buffer_modified;
  1887	            }
  1888	
  1889	            // If our font atlas changed, sync the texture data
  1890	            texture: {
  1891	                const modified = self.font_grid.atlas_grayscale.modified.load(.monotonic);
  1892	                if (modified <= frame.grayscale_modified) break :texture;
  1893	                self.font_grid.lock.lockSharedUncancelable(global.io());
  1894	                defer self.font_grid.lock.unlockShared(global.io());
  1895	                frame.grayscale_modified = self.font_grid.atlas_grayscale.modified.load(.monotonic);
  1896	                try self.syncAtlasTexture(&self.font_grid.atlas_grayscale, &frame.grayscale);
  1897	            }
  1898	            texture: {
  1899	                const modified = self.font_grid.atlas_color.modified.load(.monotonic);
  1900	                if (modified <= frame.color_modified) break :texture;
  1901	                self.font_grid.lock.lockSharedUncancelable(global.io());
  1902	                defer self.font_grid.lock.unlockShared(global.io());
  1903	                frame.color_modified = self.font_grid.atlas_color.modified.load(.monotonic);
  1904	                try self.syncAtlasTexture(&self.font_grid.atlas_color, &frame.color);
  1905	            }
  1906	
  1907	            // Get a frame context from the graphics API.
  1908	            var frame_ctx = try self.api.beginFrame(self, &frame.target);
  1909	            defer frame_ctx.complete(sync);
  1910	
  1911	            {
  1912	                var pass = frame_ctx.renderPass(&.{.{
  1913	                    .target = if (frame.custom_shader_state) |state|
  1914	                        .{ .texture = state.back_texture }
  1915	                    else
  1916	                        .{ .target = frame.target },
  1917	                    .clear_color = .{ 0.0, 0.0, 0.0, 0.0 },
  1918	                }});
  1919	                defer pass.complete();
  1920	
  1921	                // First we draw our background image, if we have one.
  1922	                // The bg image shader also draws the main bg color.
  1923	                //
  1924	                // Otherwise, if we don't have a background image, we
  1925	                // draw the background color by itself in its own step.
  1926	                //
  1927	                // NOTE: We don't use the clear_color for this because that
  1928	                //       would require us to do color space conversion on the
  1929	                //       CPU-side. In the future when we have utilities for
  1930	                //       that we should remove this step and use clear_color.
  1931	
  1932	                if (self.bg_image) |img| switch (img) {
  1933	                    .ready => |texture| pass.step(.{
  1934	                        .pipeline = self.shaders.pipelines.bg_image,
  1935	                        .uniforms = frame.uniforms.buffer,
  1936	                        .buffers = &.{frame.bg_image_buffer.buffer},
  1937	                        .textures = &.{texture},
  1938	                        .draw = .{ .type = .triangle, .vertex_count = 3 },
  1939	                    }),
  1940	                    else => {},
  1941	                } else {
  1942	                    pass.step(.{
  1943	                        .pipeline = self.shaders.pipelines.bg_color,
  1944	                        .uniforms = frame.uniforms.buffer,
  1945	                        .buffers = &.{ null, frame.cells_bg.buffer },
  1946	                        .draw = .{ .type = .triangle, .vertex_count = 3 },
  1947	                    });
  1948	                }
  1949	
  1950	                // Then we draw any kitty images that need
  1951	                // to be behind text AND cell backgrounds.
  1952	                self.images.draw(
  1953	                    &self.api,
  1954	                    self.shaders.pipelines.image,
  1955	                    &pass,
  1956	                    .kitty_below_bg,
  1957	                );
  1958	
  1959	                // Then we draw any opaque cell backgrounds.
  1960	                pass.step(.{
  1961	                    .pipeline = self.shaders.pipelines.cell_bg,
  1962	                    .uniforms = frame.uniforms.buffer,
  1963	                    .buffers = &.{ null, frame.cells_bg.buffer },
  1964	                    .draw = .{ .type = .triangle, .vertex_count = 3 },
  1965	                });
  1966	
  1967	                // Kitty images between cell backgrounds and text.
  1968	                self.images.draw(
  1969	                    &self.api,
  1970	                    self.shaders.pipelines.image,
  1971	                    &pass,
  1972	                    .kitty_below_text,
  1973	                );
  1974	
  1975	                // Text.
  1976	                pass.step(.{
  1977	                    .pipeline = self.shaders.pipelines.cell_text,
  1978	                    .uniforms = frame.uniforms.buffer,
  1979	                    .buffers = &.{
  1980	                        frame.cells.buffer,
  1981	                        frame.cells_bg.buffer,
  1982	                    },
  1983	                    .textures = &.{
  1984	                        frame.grayscale,
  1985	                        frame.color,
  1986	                    },
  1987	                    .draw = .{
  1988	                        .type = .triangle_strip,
  1989	                        .vertex_count = 4,
  1990	                        .instance_count = fg_count,
  1991	                    },
  1992	                });
  1993	
  1994	                // Kitty images in front of text.
  1995	                self.images.draw(
  1996	                    &self.api,
  1997	                    self.shaders.pipelines.image,
  1998	                    &pass,
  1999	                    .kitty_above_text,
  2000	                );
  2001	
  2002	                // Debug overlay. We do this before any custom shader state
  2003	                // because our debug overlay is aligned with the grid.
  2004	                if (self.overlay != null) self.images.draw(
  2005	                    &self.api,
  2006	                    self.shaders.pipelines.image,
  2007	                    &pass,
  2008	                    .overlay,
  2009	                );
  2010	            }
  2011	
  2012	            // If we have custom shaders, then we render them.
  2013	            if (frame.custom_shader_state) |*state| {
  2014	                // Sync our uniforms.
  2015	                try state.uniforms.sync(&.{self.custom_shader_uniforms});
  2016	
  2017	                for (self.shaders.post_pipelines, 0..) |pipeline, i| {
  2018	                    defer state.swap();
  2019	
  2020	                    var pass = frame_ctx.renderPass(&.{.{
  2021	                        .target = if (i < self.shaders.post_pipelines.len - 1)
  2022	                            .{ .texture = state.front_texture }
  2023	                        else
  2024	                            .{ .target = frame.target },
  2025	                        .clear_color = .{ 0.0, 0.0, 0.0, 0.0 },
  2026	                    }});
  2027	                    defer pass.complete();
  2028	
  2029	                    pass.step(.{
  2030	                        .pipeline = pipeline,
  2031	                        .uniforms = state.uniforms.buffer,
  2032	                        .textures = &.{state.back_texture},
  2033	                        .samplers = &.{state.sampler},
  2034	                        .draw = .{
  2035	                            .type = .triangle,
  2036	                            .vertex_count = 3,
  2037	                        },
  2038	                    });
  2039	                }
  2040	            }
  2041	
  2042	            return false;
  2043	        }
  2044	
  2045	        // Callback from the graphics API when a frame is completed.
  2046	        pub fn frameCompleted(
  2047	            self: *Self,
  2048	            health: Health,
  2049	        ) void {
  2050	            // If our health value hasn't changed, then we do nothing. We don't
  2051	            // do a cmpxchg here because strict atomicity isn't important.
  2052	            if (self.health.load(.seq_cst) != health) {
  2053	                self.health.store(health, .seq_cst);
  2054	
  2055	                // Our health value changed, so we notify the surface so that it
  2056	                // can do something about it.
  2057	                _ = self.surface_mailbox.push(.{
  2058	                    .renderer_health = health,
  2059	                }, .{ .forever = {} });
  2060	            }
  2061	
  2062	            // Always release our semaphore. The swap chain is
  2063	            // guaranteed to exist here: it is only torn down after
  2064	            // waiting for all in-flight frames to complete, and this
  2065	            // callback is what signals that completion.
  2066	            self.swap_chain.?.releaseFrame();
  2067	        }
  2068	
  2069	        /// Call this any time the background image path changes.
  2070	        ///
  2071	        /// Caller must hold the draw mutex.
  2072	        fn prepBackgroundImage(self: *Self) !void {
  2073	            // Then we try to load the background image if we have a path.
  2074	            if (self.config.bg_image) |p| load_background: {
  2075	                const path = switch (p) {
  2076	                    .required, .optional => |slice| slice,
  2077	                };
  2078	
  2079	                // Open the file
  2080	                var file = std.Io.Dir.openFileAbsolute(
  2081	                    global.io(),
  2082	                    path,
  2083	                    .{},
  2084	                ) catch |err| {
  2085	                    log.warn(
  2086	                        "error opening background image file \"{s}\": {}",
  2087	                        .{ path, err },
  2088	                    );
  2089	                    break :load_background;
  2090	                };
  2091	                defer file.close(global.io());
  2092	
  2093	                // Read it
  2094	                const contents = compat_file.readToEndAlloc(
  2095	                    file,
  2096	                    self.alloc,
  2097	                    std.math.maxInt(u32), // Max size of 4 GiB, for now.
  2098	                ) catch |err| {
  2099	                    log.warn(
  2100	                        "error reading background image file \"{s}\": {}",
  2101	                        .{ path, err },
  2102	                    );
  2103	                    break :load_background;
  2104	                };
  2105	                defer self.alloc.free(contents);
  2106	
  2107	                // Figure out what type it probably is.
  2108	                const file_type = switch (FileType.detect(contents)) {
  2109	                    .unknown => FileType.guessFromExtension(
  2110	                        std.fs.path.extension(path),
  2111	                    ),
  2112	                    else => |t| t,
  2113	                };
  2114	
  2115	                // Decode it if we know how.
  2116	                const image_data = switch (file_type) {
  2117	                    .png => try wuffs.png.decode(self.alloc, contents),
  2118	                    .jpeg => try wuffs.jpeg.decode(self.alloc, contents),
  2119	                    .unknown => {
  2120	                        log.warn(
  2121	                            "Cannot determine file type for background image file \"{s}\"!",
  2122	                            .{path},
  2123	                        );
  2124	                        break :load_background;
  2125	                    },
  2126	                    else => |f| {
  2127	                        log.warn(
  2128	                            "Unsupported file type {} for background image file \"{s}\"!",
  2129	                            .{ f, path },
  2130	                        );
  2131	                        break :load_background;
  2132	                    },
  2133	                };
  2134	
  2135	                const image: imagepkg.Image = .{
  2136	                    .pending = .{
  2137	                        .width = image_data.width,
  2138	                        .height = image_data.height,
  2139	                        .pixel_format = .rgba,
  2140	                        .data = image_data.data.ptr,
  2141	                    },
  2142	                };
  2143	
  2144	                // If we have an existing background image, replace it.
  2145	                // Otherwise, set this as our background image directly.
  2146	                if (self.bg_image) |*img| {
  2147	                    img.markForReplace(self.alloc, image);
  2148	                } else {
  2149	                    self.bg_image = image;
  2150	                }
  2151	            } else {
  2152	                // If we don't have a background image path, mark our
  2153	                // background image for unload if we currently have one.
  2154	                if (self.bg_image) |*img| img.markForUnload();
  2155	            }
  2156	        }
  2157	
  2158	        fn uploadBackgroundImage(self: *Self) !void {
  2159	            // Make sure our bg image is uploaded if it needs to be.
  2160	            if (self.bg_image) |*bg| {
  2161	                if (bg.isUnloading()) {
  2162	                    bg.deinit(self.alloc);
  2163	                    self.bg_image = null;
  2164	                    return;
  2165	                }
  2166	                if (bg.isPending()) try bg.upload(self.alloc, &self.api);
  2167	            }
  2168	        }
  2169	
  2170	        /// Update the configuration.
  2171	        pub fn changeConfig(self: *Self, config: *DerivedConfig) !void {
  2172	            self.draw_mutex.lockUncancelable(global.io());
  2173	            defer self.draw_mutex.unlock(global.io());
  2174	
  2175	            // We always redo the font shaper in case font features changed. We
  2176	            // could check to see if there was an actual config change but this is
  2177	            // easier and rare enough to not cause performance issues.
  2178	            {
  2179	                var font_shaper = try font.Shaper.init(self.alloc, .{
  2180	                    .features = config.font_features.items,
  2181	                });
  2182	                errdefer font_shaper.deinit();
  2183	                self.font_shaper.deinit();
  2184	                self.font_shaper = font_shaper;
  2185	            }
  2186	
  2187	            // We also need to reset the shaper cache so shaper info
  2188	            // from the previous font isn't reused for the new font.
  2189	            const font_shaper_cache = font.ShaperCache.init();
  2190	            self.font_shaper_cache.deinit(self.alloc);
  2191	            self.font_shaper_cache = font_shaper_cache;
  2192	
  2193	            // Set our new minimum contrast
  2194	            self.uniforms.min_contrast = config.min_contrast;
  2195	
  2196	            // Set our new color space and blending
  2197	            self.uniforms.bools.use_display_p3 = config.colorspace == .@"display-p3";
  2198	            self.uniforms.bools.use_linear_blending = config.blending.isLinear();
  2199	            self.uniforms.bools.use_linear_correction = config.blending == .@"linear-corrected";
  2200	
  2201	            const bg_image_config_changed =
  2202	                self.config.bg_image_fit != config.bg_image_fit or
  2203	                self.config.bg_image_position != config.bg_image_position or
  2204	                self.config.bg_image_repeat != config.bg_image_repeat or
  2205	                self.config.bg_image_opacity != config.bg_image_opacity;
  2206	
  2207	            const bg_image_changed =
  2208	                if (self.config.bg_image) |old|
  2209	                    if (config.bg_image) |new|
  2210	                        !old.equal(new)
  2211	                    else
  2212	                        true
  2213	                else
  2214	                    config.bg_image != null;
  2215	
  2216	            const old_blending = self.config.blending;
  2217	            const custom_shaders_changed = !self.config.custom_shaders.equal(config.custom_shaders);
  2218	
  2219	            self.config.deinit();
  2220	            self.config = config.*;
  2221	
  2222	            // If our background image path changed, prepare the new bg image.
  2223	            if (bg_image_changed) try self.prepBackgroundImage();
  2224	
  2225	            // If our background image config changed, update the vertex buffer.
  2226	            if (bg_image_config_changed) self.updateBgImageBuffer();
  2227	
  2228	            // Reset our viewport to force a rebuild, in case of a font change.
  2229	            self.markDirty();
  2230	
  2231	            const blending_changed = old_blending != config.blending;
  2232	
  2233	            if (blending_changed) {
  2234	                // We update our API's blending mode.
  2235	                self.api.blending = config.blending;
  2236	                // And indicate that we need to reinitialize our shaders.
  2237	                self.reinitialize_shaders = true;
  2238	                // And indicate that our swap chain targets need to
  2239	                // be re-created to account for the new blending mode.
  2240	                self.target_config_modified +%= 1;
  2241	            }
  2242	
  2243	            if (custom_shaders_changed) {
  2244	                self.reinitialize_shaders = true;
  2245	            }
  2246	        }
  2247	
  2248	        /// Resize the screen.
  2249	        pub fn setScreenSize(
  2250	            self: *Self,
  2251	            size: renderer.Size,
  2252	        ) void {
  2253	            self.draw_mutex.lockUncancelable(global.io());
  2254	            defer self.draw_mutex.unlock(global.io());
  2255	
  2256	            self.size = size;
  2257	            self.updateScreenSizeUniforms();
  2258	
  2259	            // Some graphics APIs need to manually update their viewport,
  2260	            // like OpenGL. Do so here.
  2261	            if (@hasDecl(GraphicsAPI, "setViewport")) {
  2262	                self.api.setViewport(self.size.screen.width, self.size.screen.height);
  2263	            }
  2264	
  2265	            log.debug("screen size size={}", .{size});
  2266	        }
  2267	
  2268	        /// Update uniforms that are based on the screen size.
  2269	        ///
  2270	        /// Caller must hold the draw mutex.
  2271	        fn updateScreenSizeUniforms(self: *Self) void {
  2272	            const terminal_size = self.size.terminal();
  2273	
  2274	            // Blank space around the grid.
  2275	            const blank: renderer.Padding = self.size.screen.blankPadding(
  2276	                self.size.padding,
  2277	                .{
  2278	                    .columns = self.cells.size.columns,
  2279	                    .rows = self.cells.size.rows,
  2280	                },
  2281	                .{
  2282	                    .width = self.grid_metrics.cell_width,
  2283	                    .height = self.grid_metrics.cell_height,
  2284	                },
  2285	            ).add(self.size.padding);
  2286	
  2287	            // Setup our uniforms
  2288	            self.uniforms.projection_matrix = @bitCast(math.ortho2d(
  2289	                -1 * @as(f32, @floatFromInt(self.size.padding.left)),
  2290	                @floatFromInt(terminal_size.width + self.size.padding.right),
  2291	                @floatFromInt(terminal_size.height + self.size.padding.bottom),
  2292	                -1 * @as(f32, @floatFromInt(self.size.padding.top)),
  2293	            ));
  2294	            self.uniforms.grid_padding = .{
  2295	                @floatFromInt(blank.top),
  2296	                @floatFromInt(blank.right),
  2297	                @floatFromInt(blank.bottom),
  2298	                @floatFromInt(blank.left),
  2299	            };
  2300	            self.uniforms.screen_size = .{
  2301	                @floatFromInt(self.size.screen.width),
  2302	                @floatFromInt(self.size.screen.height),
  2303	            };
  2304	        }
  2305	
  2306	        /// Update the background image vertex buffer (CPU-side).
  2307	        ///
  2308	        /// This should be called if and when configs change that
  2309	        /// could affect the background image.
  2310	        ///
  2311	        /// Caller must hold the draw mutex.
  2312	        fn updateBgImageBuffer(self: *Self) void {
  2313	            self.bg_image_buffer = .{
  2314	                .opacity = self.config.bg_image_opacity,
  2315	                .info = .{
  2316	                    .position = switch (self.config.bg_image_position) {
  2317	                        .@"top-left" => .tl,
  2318	                        .@"top-center" => .tc,
  2319	                        .@"top-right" => .tr,
  2320	                        .@"center-left" => .ml,
  2321	                        .@"center-center", .center => .mc,
  2322	                        .@"center-right" => .mr,
  2323	                        .@"bottom-left" => .bl,
  2324	                        .@"bottom-center" => .bc,
  2325	                        .@"bottom-right" => .br,
  2326	                    },
  2327	                    .fit = switch (self.config.bg_image_fit) {
  2328	                        .contain => .contain,
  2329	                        .cover => .cover,
  2330	                        .stretch => .stretch,
  2331	                        .none => .none,
  2332	                    },
  2333	                    .repeat = self.config.bg_image_repeat,
  2334	                },
  2335	            };
  2336	            // Signal that the buffer was modified.
  2337	            self.bg_image_buffer_modified +%= 1;
  2338	        }
  2339	
  2340	        /// Update custom shader uniforms that depend on terminal state.
  2341	        ///
  2342	        /// This should be called in `updateFrame` when terminal state changes.
  2343	        fn updateCustomShaderUniformsFromState(self: *Self) void {
  2344	            // We only need to do this if we have custom shaders.
  2345	            if (!self.has_custom_shaders) return;
  2346	
  2347	            // Only update when terminal state is dirty.
  2348	            if (self.terminal_state.dirty == .false) return;
  2349	
  2350	            const uniforms: *shadertoy.Uniforms = &self.custom_shader_uniforms;
  2351	            const colors: *const terminal.RenderState.Colors = &self.terminal_state.colors;
  2352	
  2353	            // 256-color palette
  2354	            for (colors.palette, 0..) |color, i| {
  2355	                uniforms.palette[i] = .{
  2356	                    @as(f32, @floatFromInt(color.r)) / 255.0,
  2357	                    @as(f32, @floatFromInt(color.g)) / 255.0,
  2358	                    @as(f32, @floatFromInt(color.b)) / 255.0,
  2359	                    1.0,
  2360	                };
  2361	            }
  2362	
  2363	            // Background color
  2364	            uniforms.background_color = .{
  2365	                @as(f32, @floatFromInt(colors.background.r)) / 255.0,
  2366	                @as(f32, @floatFromInt(colors.background.g)) / 255.0,
  2367	                @as(f32, @floatFromInt(colors.background.b)) / 255.0,
  2368	                1.0,
  2369	            };
  2370	
  2371	            // Foreground color
  2372	            uniforms.foreground_color = .{
  2373	                @as(f32, @floatFromInt(colors.foreground.r)) / 255.0,
  2374	                @as(f32, @floatFromInt(colors.foreground.g)) / 255.0,
  2375	                @as(f32, @floatFromInt(colors.foreground.b)) / 255.0,
  2376	                1.0,
  2377	            };
  2378	
  2379	            // Cursor color
  2380	            if (colors.cursor) |cursor_color| {
  2381	                uniforms.cursor_color = .{
  2382	                    @as(f32, @floatFromInt(cursor_color.r)) / 255.0,
  2383	                    @as(f32, @floatFromInt(cursor_color.g)) / 255.0,
  2384	                    @as(f32, @floatFromInt(cursor_color.b)) / 255.0,
  2385	                    1.0,
  2386	                };
  2387	            }
  2388	
  2389	            // NOTE: the following could be optimized to follow a change in
  2390	            // config for a slight optimization however this is only 12 bytes
  2391	            // each being updated and likely isn't a cause for concern
  2392	
  2393	            // Cursor text color
  2394	            if (self.config.cursor_text) |cursor_text| {
  2395	                uniforms.cursor_text = .{
  2396	                    @as(f32, @floatFromInt(cursor_text.color.r)) / 255.0,
  2397	                    @as(f32, @floatFromInt(cursor_text.color.g)) / 255.0,
  2398	                    @as(f32, @floatFromInt(cursor_text.color.b)) / 255.0,
  2399	                    1.0,
  2400	                };
  2401	            }
  2402	
  2403	            // Selection background color
  2404	            if (self.config.selection_background) |selection_bg| {
  2405	                uniforms.selection_background_color = .{
  2406	                    @as(f32, @floatFromInt(selection_bg.color.r)) / 255.0,
  2407	                    @as(f32, @floatFromInt(selection_bg.color.g)) / 255.0,
  2408	                    @as(f32, @floatFromInt(selection_bg.color.b)) / 255.0,
  2409	                    1.0,
  2410	                };
  2411	            }
  2412	
  2413	            // Selection foreground color
  2414	            if (self.config.selection_foreground) |selection_fg| {
  2415	                uniforms.selection_foreground_color = .{
  2416	                    @as(f32, @floatFromInt(selection_fg.color.r)) / 255.0,
  2417	                    @as(f32, @floatFromInt(selection_fg.color.g)) / 255.0,
  2418	                    @as(f32, @floatFromInt(selection_fg.color.b)) / 255.0,
  2419	                    1.0,
  2420	                };
  2421	            }
  2422	
  2423	            // Cursor visibility
  2424	            uniforms.cursor_visible = @intFromBool(self.terminal_state.cursor.visible);
  2425	
  2426	            // Cursor style
  2427	            const cursor_style: renderer.CursorStyle = .fromTerminal(self.terminal_state.cursor.visual_style);
  2428	            uniforms.previous_cursor_style = uniforms.current_cursor_style;
  2429	            uniforms.current_cursor_style = @as(i32, @backingInt(cursor_style));
  2430	        }
  2431	
  2432	        /// Update per-frame custom shader uniforms.
  2433	        ///
  2434	        /// This should be called exactly once per frame, inside `drawFrame`.
  2435	        fn updateCustomShaderUniformsForFrame(self: *Self) !void {
  2436	            // We only need to do this if we have custom shaders.
  2437	            if (!self.has_custom_shaders) return;
  2438	
  2439	            const uniforms: *shadertoy.Uniforms = &self.custom_shader_uniforms;
  2440	
  2441	            const now: std.Io.Timestamp = .now(global.io(), .awake);
  2442	            defer self.last_frame_time = now;
  2443	            const first_frame_time = self.first_frame_time orelse t: {
  2444	                self.first_frame_time = now;
  2445	                break :t now;
  2446	            };
  2447	            const last_frame_time = self.last_frame_time orelse now;
  2448	
  2449	            const since_ns: f32 = @floatFromInt(first_frame_time.durationTo(now).nanoseconds);
  2450	            uniforms.time = since_ns / std.time.ns_per_s;
  2451	
  2452	            const delta_ns: f32 = @floatFromInt(last_frame_time.durationTo(now).nanoseconds);
  2453	            uniforms.time_delta = delta_ns / std.time.ns_per_s;
  2454	
  2455	            uniforms.frame += 1;
  2456	
  2457	            const screen = self.size.screen;
  2458	            const padding = self.size.padding;
  2459	            const cell = self.size.cell;
  2460	
  2461	            uniforms.resolution = .{
  2462	                @floatFromInt(screen.width),
  2463	                @floatFromInt(screen.height),
  2464	                1,
  2465	            };
  2466	            uniforms.channel_resolution[0] = .{
  2467	                @floatFromInt(screen.width),
  2468	                @floatFromInt(screen.height),
  2469	                1,
  2470	                0,
  2471	            };
  2472	
  2473	            if (self.cells.getCursorGlyph()) |cursor| {
  2474	                const cursor_width: f32 = @floatFromInt(cursor.glyph_size[0]);
  2475	                const cursor_height: f32 = @floatFromInt(cursor.glyph_size[1]);
  2476	
  2477	                // Left edge of the cell the cursor is in.
  2478	                var pixel_x: f32 = @floatFromInt(
  2479	                    cursor.grid_pos[0] * cell.width + padding.left,
  2480	                );
  2481	                // Top edge, relative to the top of the
  2482	                // screen, of the cell the cursor is in.
  2483	                var pixel_y: f32 = @floatFromInt(
  2484	                    cursor.grid_pos[1] * cell.height + padding.top,
  2485	                );
  2486	
  2487	                // If +Y is up in our shaders, we need to flip the coordinate
  2488	                // so that it's instead the top edge of the cell relative to
  2489	                // the *bottom* of the screen.
  2490	                if (!GraphicsAPI.custom_shader_y_is_down) {
  2491	                    pixel_y = @as(f32, @floatFromInt(screen.height)) - pixel_y;
  2492	                }
  2493	
  2494	                // Add the X bearing to get the -X (left) edge of the cursor.
  2495	                pixel_x += @floatFromInt(cursor.bearings[0]);
  2496	
  2497	                // How we deal with the Y bearing depends on which direction
  2498	                // is "up", since we want our final `pixel_y` value to be the
  2499	                // +Y edge of the cursor.
  2500	                if (GraphicsAPI.custom_shader_y_is_down) {
  2501	                    // As a reminder, the Y bearing is the distance from the
  2502	                    // bottom of the cell to the top of the glyph, so to get
  2503	                    // the +Y edge we need to add the cell height, subtract
  2504	                    // the Y bearing, and add the glyph height to get the +Y
  2505	                    // (bottom) edge of the cursor.
  2506	                    pixel_y += @floatFromInt(cell.height);
  2507	                    pixel_y -= @floatFromInt(cursor.bearings[1]);
  2508	                    pixel_y += @floatFromInt(cursor.glyph_size[1]);
  2509	                } else {
  2510	                    // If the Y direction is reversed though, we instead want
  2511	                    // the *top* edge of the cursor, which means we just need
  2512	                    // to subtract the cell height and add the Y bearing.
  2513	                    pixel_y -= @floatFromInt(cell.height);
  2514	                    pixel_y += @floatFromInt(cursor.bearings[1]);
  2515	                }
  2516	
  2517	                const new_cursor: [4]f32 = .{
  2518	                    pixel_x,
  2519	                    pixel_y,
  2520	                    cursor_width,
  2521	                    cursor_height,
  2522	                };
  2523	                const cursor_color: [4]f32 = .{
  2524	                    @as(f32, @floatFromInt(cursor.color[0])) / 255.0,
  2525	                    @as(f32, @floatFromInt(cursor.color[1])) / 255.0,
  2526	                    @as(f32, @floatFromInt(cursor.color[2])) / 255.0,
  2527	                    @as(f32, @floatFromInt(cursor.color[3])) / 255.0,
  2528	                };
  2529	
  2530	                const cursor_changed: bool =
  2531	                    !std.meta.eql(new_cursor, uniforms.current_cursor) or
  2532	                    !std.meta.eql(cursor_color, uniforms.current_cursor_color);
  2533	
  2534	                if (cursor_changed) {
  2535	                    uniforms.previous_cursor = uniforms.current_cursor;
  2536	                    uniforms.previous_cursor_color = uniforms.current_cursor_color;
  2537	                    uniforms.current_cursor = new_cursor;
  2538	                    uniforms.current_cursor_color = cursor_color;
  2539	                    uniforms.cursor_change_time = uniforms.time;
  2540	                }
  2541	            }
  2542	
  2543	            // Update focus uniforms
  2544	            uniforms.focus = @intFromBool(self.focused);
  2545	
  2546	            // If we need to update the time our focus state changed
  2547	            // then update it to our current frame time. This may not be
  2548	            // exactly correct since it is frame time, not exact focus
  2549	            // time, but focus time on its own isn't exactly correct anyways
  2550	            // since it comes async from a message.
  2551	            if (self.custom_shader_focused_changed and self.focused) {
  2552	                uniforms.time_focus = uniforms.time;
  2553	                self.custom_shader_focused_changed = false;
  2554	            }
  2555	        }
  2556	
  2557	        /// Build the overlay as configured. Returns null if there is no
  2558	        /// overlay currently configured.
  2559	        fn rebuildOverlay(
  2560	            self: *Self,
  2561	            features: []const Overlay.Feature,
  2562	        ) Overlay.InitError!void {
  2563	            const alloc = self.alloc;
  2564	
  2565	            // If we have no features enabled, don't build an overlay.
  2566	            // If we had a previous overlay, deallocate it.
  2567	            if (features.len == 0) {
  2568	                if (self.overlay) |*old| {
  2569	                    old.deinit(alloc);
  2570	                    self.overlay = null;
  2571	                }
  2572	
  2573	                return;
  2574	            }
  2575	
  2576	            // If we had a previous overlay, clear it. Otherwise, init.
  2577	            const overlay: *Overlay = overlay: {
  2578	                if (self.overlay) |*v| existing: {
  2579	                    // Verify that our overlay size matches our screen
  2580	                    // size as we know it now. If not, deinit and reinit.
  2581	                    // Note: these intCasts are always safe because z2d
  2582	                    // stores as i32 but we always init with a u32.
  2583	                    const width: u32 = @intCast(v.surface.getWidth());
  2584	                    const height: u32 = @intCast(v.surface.getHeight());
  2585	                    const term_size = self.size.terminal();
  2586	                    if (width != term_size.width or
  2587	                        height != term_size.height) break :existing;
  2588	
  2589	                    // We also depend on cell size.
  2590	                    if (v.cell_size.width != self.size.cell.width or
  2591	                        v.cell_size.height != self.size.cell.height) break :existing;
  2592	
  2593	                    // Everything matches, so we can just reset the surface
  2594	                    // and redraw.
  2595	                    v.reset();
  2596	                    break :overlay v;
  2597	                }
  2598	
  2599	                // If we reached this point we want to reset our overlay.
  2600	                if (self.overlay) |*v| {
  2601	                    v.deinit(alloc);
  2602	                    self.overlay = null;
  2603	                }
  2604	
  2605	                assert(self.overlay == null);
  2606	                const new: Overlay = try .init(alloc, self.size);
  2607	                self.overlay = new;
  2608	                break :overlay &self.overlay.?;
  2609	            };
  2610	            overlay.applyFeatures(
  2611	                alloc,
  2612	                &self.terminal_state,
  2613	                features,
  2614	            );
  2615	        }
  2616	
  2617	        const PreeditRange = struct {
  2618	            y: terminal.size.CellCountInt,
  2619	            x: [2]terminal.size.CellCountInt,
  2620	            cp_offset: usize,
  2621	        };
  2622	
  2623	        /// Convert the terminal state to GPU cells stored in CPU memory. These
  2624	        /// are then synced to the GPU in the next frame. This only updates CPU
  2625	        /// memory and doesn't touch the GPU.
  2626	        ///
  2627	        /// This requires the draw mutex.
  2628	        ///
  2629	        /// Dirty state on terminal state won't be reset by this.
  2630	        fn rebuildCells(
  2631	            self: *Self,
  2632	            preedit: ?renderer.State.Preedit,
  2633	            cursor_style_: ?renderer.CursorStyle,
  2634	            links: *const terminal.RenderState.CellSet,
  2635	        ) Allocator.Error!void {
  2636	            const state: *terminal.RenderState = &self.terminal_state;
  2637	
  2638	            const grid_size_diff =
  2639	                self.cells.size.rows != state.rows or
  2640	                self.cells.size.columns != state.cols;
  2641	
  2642	            if (grid_size_diff) {
  2643	                var new_size = self.cells.size;
  2644	                new_size.rows = state.rows;
  2645	                new_size.columns = state.cols;
  2646	                try self.cells.resize(self.alloc, new_size);
  2647	
  2648	                // Update our uniforms accordingly, otherwise
  2649	                // our background cells will be out of place.
  2650	                self.uniforms.grid_size = .{ new_size.columns, new_size.rows };
  2651	            }
  2652	
  2653	            const rebuild = state.dirty == .full or grid_size_diff;
  2654	            if (rebuild) {
  2655	                // If we are doing a full rebuild, then we clear the entire cell buffer.
  2656	                self.cells.reset();
  2657	
  2658	                // We also reset our padding extension depending on the screen type
  2659	                switch (self.config.padding_color) {
  2660	                    .background => {},
  2661	
  2662	                    // For extension, assume we are extending in all directions.
  2663	                    // For "extend" this may be disabled due to heuristics below.
  2664	                    .extend, .@"extend-always" => {
  2665	                        self.uniforms.padding_extend = .{
  2666	                            .up = true,
  2667	                            .down = true,
  2668	                            .left = true,
  2669	                            .right = true,
  2670	                        };
  2671	                    },
  2672	                }
  2673	            }
  2674	
  2675	            // From this point on we never fail. We produce some kind of
  2676	            // working terminal state, even if incorrect.
  2677	            errdefer comptime unreachable;
  2678	
  2679	            // Get our row data from our state
  2680	            const row_data = state.row_data.slice();
  2681	            const row_raws = row_data.items(.raw);
  2682	            const row_cells = row_data.items(.cells);
  2683	            const row_dirty = row_data.items(.dirty);
  2684	            const row_selection = row_data.items(.selection);
  2685	            const row_highlights = row_data.items(.highlights);
  2686	
  2687	            // If our cell contents buffer is shorter than the screen viewport,
  2688	            // we render the rows that fit, starting from the bottom. If instead
  2689	            // the viewport is shorter than the cell contents buffer, we align
  2690	            // the top of the viewport with the top of the contents buffer.
  2691	            const row_len: usize = @min(
  2692	                state.rows,
  2693	                self.cells.size.rows,
  2694	            );
  2695	
  2696	            // Determine our x/y range for preedit. We don't want to render anything
  2697	            // here because we will render the preedit separately.
  2698	            const preedit_range: ?PreeditRange = if (preedit) |preedit_v| preedit: {
  2699	                // We base the preedit on the position of the cursor in the
  2700	                // viewport. If the cursor isn't visible in the viewport we
  2701	                // don't show it.
  2702	                const cursor_vp = state.cursor.viewport orelse
  2703	                    break :preedit null;
  2704	
  2705	                // If our preedit row isn't dirty then we don't need the
  2706	                // preedit range. This also avoids an issue later where we
  2707	                // unconditionally add preedit cells when this is set.
  2708	                if (!rebuild and !row_dirty[cursor_vp.y]) break :preedit null;
  2709	
  2710	                const range = preedit_v.range(
  2711	                    cursor_vp.x,
  2712	                    state.cols - 1,
  2713	                );
  2714	                break :preedit .{
  2715	                    .y = @intCast(cursor_vp.y),
  2716	                    .x = .{ range.start, range.end },
  2717	                    .cp_offset = range.cp_offset,
  2718	                };
  2719	            } else null;
  2720	
  2721	            for (
  2722	                0..,
  2723	                row_raws[0..row_len],
  2724	                row_cells[0..row_len],
  2725	                row_dirty[0..row_len],
  2726	                row_selection[0..row_len],
  2727	                row_highlights[0..row_len],
  2728	            ) |y_usize, row, *cells, *dirty, selection, *highlights| {
  2729	                const y: terminal.size.CellCountInt = @intCast(y_usize);
  2730	
  2731	                if (!rebuild) {
  2732	                    // Only rebuild if we are doing a full rebuild or this row is dirty.
  2733	                    if (!dirty.*) continue;
  2734	
  2735	                    // Clear the cells if the row is dirty
  2736	                    self.cells.clear(y);
  2737	                }
  2738	
  2739	                // Unmark the dirty state in our render state.
  2740	                dirty.* = false;
  2741	
  2742	                self.rebuildRow(
  2743	                    y,
  2744	                    row,
  2745	                    cells,
  2746	                    preedit_range,
  2747	                    selection,
  2748	                    highlights,
  2749	                    links,
  2750	                ) catch |err| {
  2751	                    // This should never happen except under exceptional
  2752	                    // scenarios. In this case, we don't want to corrupt
  2753	                    // our render state so just clear this row and keep
  2754	                    // trying to finish it out.
  2755	                    log.warn("error building row y={} err={}", .{ y, err });
  2756	                    self.cells.clear(y);
  2757	                };
  2758	            }
  2759	
  2760	            // Setup our cursor rendering information.
  2761	            cursor: {
  2762	                // Clear our cursor by default.
  2763	                self.cells.setCursor(null, null);
  2764	                self.uniforms.cursor_pos = .{
  2765	                    std.math.maxInt(u16),
  2766	                    std.math.maxInt(u16),
  2767	                };
  2768	
  2769	                // If the cursor isn't visible on the viewport, don't show
  2770	                // a cursor. Otherwise, get our cursor cell, because we may
  2771	                // need it for styling.
  2772	                const cursor_vp = state.cursor.viewport orelse break :cursor;
  2773	                const cursor_style: terminal.Style = cursor_style: {
  2774	                    const cells = state.row_data.items(.cells);
  2775	                    const cell = cells[cursor_vp.y].get(cursor_vp.x);
  2776	                    break :cursor_style if (cell.raw.hasStyling())
  2777	                        cell.style
  2778	                    else
  2779	                        .{};
  2780	                };
  2781	
  2782	                // If we have preedit text, we don't setup a cursor
  2783	                if (preedit != null) break :cursor;
  2784	
  2785	                // If there isn't a cursor visual style requested then
  2786	                // we don't render a cursor.
  2787	                const style = cursor_style_ orelse break :cursor;
  2788	
  2789	                // Determine the cursor color.
  2790	                const cursor_color = cursor_color: {
  2791	                    // If an explicit cursor color was set by OSC 12, use that.
  2792	                    if (state.colors.cursor) |v| break :cursor_color v;
  2793	
  2794	                    // Use our configured color if specified
  2795	                    if (self.config.cursor_color) |v| switch (v) {
  2796	                        .color => |color| break :cursor_color color.toTerminalRGB(),
  2797	
  2798	                        inline .@"cell-foreground",
  2799	                        .@"cell-background",
  2800	                        => |_, tag| {
  2801	                            const fg_style = cursor_style.fg(.{
  2802	                                .default = state.colors.foreground,
  2803	                                .palette = &state.colors.palette,
  2804	                                .bold = self.config.bold_color,
  2805	                            });
  2806	                            const bg_style = cursor_style.bg(
  2807	                                &state.cursor.cell,
  2808	                                &state.colors.palette,
  2809	                            ) orelse state.colors.background;
  2810	
  2811	                            break :cursor_color switch (tag) {
  2812	                                .color => unreachable,
  2813	                                .@"cell-foreground" => if (cursor_style.flags.inverse)
  2814	                                    bg_style
  2815	                                else
  2816	                                    fg_style,
  2817	                                .@"cell-background" => if (cursor_style.flags.inverse)
  2818	                                    fg_style
  2819	                                else
  2820	                                    bg_style,
  2821	                            };
  2822	                        },
  2823	                    };
  2824	
  2825	                    break :cursor_color state.colors.foreground;
  2826	                };
  2827	
  2828	                self.addCursor(
  2829	                    &state.cursor,
  2830	                    style,
  2831	                    cursor_color,
  2832	                );
  2833	
  2834	                // If the cursor is visible then we set our uniforms.
  2835	                if (style == .block) {
  2836	                    const wide = state.cursor.cell.wide;
  2837	
  2838	                    self.uniforms.cursor_pos = .{
  2839	                        // If we are a spacer tail of a wide cell, our cursor needs
  2840	                        // to move back one cell. The saturate is to ensure we don't
  2841	                        // overflow but this shouldn't happen with well-formed input.
  2842	                        switch (wide) {
  2843	                            .narrow, .spacer_head, .wide => cursor_vp.x,
  2844	                            .spacer_tail => cursor_vp.x -| 1,
  2845	                        },
  2846	                        @intCast(cursor_vp.y),
  2847	                    };
  2848	
  2849	                    self.uniforms.bools.cursor_wide = switch (wide) {
  2850	                        .narrow, .spacer_head => false,
  2851	                        .wide, .spacer_tail => true,
  2852	                    };
  2853	
  2854	                    const uniform_color = if (self.config.cursor_text) |txt| blk: {
  2855	                        // If cursor-text is set, then compute the correct color.
  2856	                        // Otherwise, use the background color.
  2857	                        if (txt == .color) {
  2858	                            // Use the color set by cursor-text, if any.
  2859	                            break :blk txt.color.toTerminalRGB();
  2860	                        }
  2861	
  2862	                        const fg_style = cursor_style.fg(.{
  2863	                            .default = state.colors.foreground,
  2864	                            .palette = &state.colors.palette,
  2865	                            .bold = self.config.bold_color,
  2866	                        });
  2867	                        const bg_style = cursor_style.bg(
  2868	                            &state.cursor.cell,
  2869	                            &state.colors.palette,
  2870	                        ) orelse state.colors.background;
  2871	
  2872	                        break :blk switch (txt) {
  2873	                            // If the cell is reversed, use the opposite cell color instead.
  2874	                            .@"cell-foreground" => if (cursor_style.flags.inverse)
  2875	                                bg_style
  2876	                            else
  2877	                                fg_style,
  2878	                            .@"cell-background" => if (cursor_style.flags.inverse)
  2879	                                fg_style
  2880	                            else
  2881	                                bg_style,
  2882	                            else => unreachable,
  2883	                        };
  2884	                    } else state.colors.background;
  2885	
  2886	                    self.uniforms.cursor_color = .{
  2887	                        uniform_color.r,
  2888	                        uniform_color.g,
  2889	                        uniform_color.b,
  2890	                        255,
  2891	                    };
  2892	                }
  2893	            }
  2894	
  2895	            // Setup our preedit text.
  2896	            if (preedit) |preedit_v| preedit: {
  2897	                const range = preedit_range orelse break :preedit;
  2898	                var x = range.x[0];
  2899	                for (preedit_v.codepoints[range.cp_offset..]) |cp| {
  2900	                    self.addPreeditCell(
  2901	                        cp,
  2902	                        .{ .x = x, .y = range.y },
  2903	                        state.colors.foreground,
  2904	                    ) catch |err| {
  2905	                        log.warn("error building preedit cell, will be invalid x={} y={}, err={}", .{
  2906	                            x,
  2907	                            range.y,
  2908	                            err,
  2909	                        });
  2910	                    };
  2911	
  2912	                    x += if (cp.wide) 2 else 1;
  2913	                }
  2914	            }
  2915	
  2916	            // Update that our cells rebuilt
  2917	            self.cells_rebuilt = true;
  2918	
  2919	            // Log some things
  2920	            // log.debug("rebuildCells complete cached_runs={}", .{
  2921	            //     self.font_shaper_cache.count(),
  2922	            // });
  2923	        }
  2924	
  2925	        fn rebuildRow(
  2926	            self: *Self,
  2927	            y: terminal.size.CellCountInt,
  2928	            row: terminal.page.Row,
  2929	            cells: *std.MultiArrayList(terminal.RenderState.Cell),
  2930	            preedit_range: ?PreeditRange,
  2931	            selection: ?[2]terminal.size.CellCountInt,
  2932	            highlights: *const std.ArrayList(terminal.RenderState.Highlight),
  2933	            links: *const terminal.RenderState.CellSet,
  2934	        ) !void {
  2935	            const state = &self.terminal_state;
  2936	
  2937	            // If our viewport is wider than our cell contents buffer,
  2938	            // we still only process cells up to the width of the buffer.
  2939	            const cells_slice = cells.slice();
  2940	            const cells_len = @min(cells_slice.len, self.cells.size.columns);
  2941	            const cells_raw = cells_slice.items(.raw);
  2942	            const cells_style = cells_slice.items(.style);
  2943	
  2944	            // On primary screen, we still apply vertical padding
  2945	            // extension under certain conditions we feel are safe.
  2946	            //
  2947	            // This helps make some scenarios look better while
  2948	            // avoiding scenarios we know do NOT look good.
  2949	            switch (self.config.padding_color) {
  2950	                // These already have the correct values set above.
  2951	                .background, .@"extend-always" => {},
  2952	
  2953	                // Apply heuristics for padding extension.
  2954	                .extend => if (y == 0) {
  2955	                    self.uniforms.padding_extend.up = !rowNeverExtendBg(
  2956	                        row,
  2957	                        cells_raw,
  2958	                        cells_style,
  2959	                        &state.colors.palette,
  2960	                        state.colors.background,
  2961	                    );
  2962	                } else if (y == self.cells.size.rows - 1) {
  2963	                    self.uniforms.padding_extend.down = !rowNeverExtendBg(
  2964	                        row,
  2965	                        cells_raw,
  2966	                        cells_style,
  2967	                        &state.colors.palette,
  2968	                        state.colors.background,
  2969	                    );
  2970	                },
  2971	            }
  2972	
  2973	            // Iterator of runs for shaping.
  2974	            var run_iter_opts: font.shape.RunOptions = .{
  2975	                .grid = self.font_grid,
  2976	                .cells = cells_slice,
  2977	                .selection = if (selection) |s| s else null,
  2978	
  2979	                // We want to do font shaping as long as the cursor is
  2980	                // visible on this viewport.
  2981	                .cursor_x = cursor_x: {
  2982	                    const vp = state.cursor.viewport orelse break :cursor_x null;
  2983	                    if (vp.y != y) break :cursor_x null;
  2984	                    break :cursor_x vp.x;
  2985	                },
  2986	            };
  2987	            run_iter_opts.applyBreakConfig(self.config.font_shaping_break);
  2988	            var run_iter = self.font_shaper.runIterator(run_iter_opts);
  2989	            var shaper_run: ?font.shape.TextRun = try run_iter.next(self.alloc);
  2990	            var shaper_cells: ?[]const font.shape.Cell = null;
  2991	            var shaper_cells_i: usize = 0;
  2992	
  2993	            for (
  2994	                0..,
  2995	                cells_raw[0..cells_len],
  2996	                cells_style[0..cells_len],
  2997	            ) |x, *cell, *managed_style| {
  2998	                // If this cell falls within our preedit range then we
  2999	                // skip this because preedits are setup separately.
  3000	                if (preedit_range) |range| preedit: {
  3001	                    // We're not on the preedit line, no actions necessary.
  3002	                    if (range.y != y) break :preedit;
  3003	                    // We're before the preedit range, no actions necessary.
  3004	                    if (x < range.x[0]) break :preedit;
  3005	                    // We're in the preedit range, skip this cell.
  3006	                    if (x <= range.x[1]) continue;
  3007	                    // After exiting the preedit range we need to catch
  3008	                    // the run position up because of the missed cells.
  3009	                    // In all other cases, no action is necessary.
  3010	                    if (x != range.x[1] + 1) break :preedit;
  3011	
  3012	                    // Step the run iterator until we find a run that ends
  3013	                    // after the current cell, which will be the soonest run
  3014	                    // that might contain glyphs for our cell.
  3015	                    while (shaper_run) |run| {
  3016	                        if (run.offset + run.cells > x) break;
  3017	                        shaper_run = try run_iter.next(self.alloc);
  3018	                        shaper_cells = null;
  3019	                        shaper_cells_i = 0;
  3020	                    }
  3021	
  3022	                    const run = shaper_run orelse break :preedit;
  3023	
  3024	                    // If we haven't shaped this run, do so now.
  3025	                    shaper_cells = shaper_cells orelse
  3026	                        // Try to read the cells from the shaping cache if we can.
  3027	                        self.font_shaper_cache.get(run) orelse
  3028	                        cache: {
  3029	                            // Otherwise we have to shape them.
  3030	                            const new_cells = try self.font_shaper.shape(run);
  3031	
  3032	                            // Try to cache them. If caching fails for any reason we
  3033	                            // continue because it is just a performance optimization,
  3034	                            // not a correctness issue.
  3035	                            self.font_shaper_cache.put(
  3036	                                self.alloc,
  3037	                                run,
  3038	                                new_cells,
  3039	                            ) catch |err| {
  3040	                                log.warn(
  3041	                                    "error caching font shaping results err={}",
  3042	                                    .{err},
  3043	                                );
  3044	                            };
  3045	
  3046	                            // The cells we get from direct shaping are always owned
  3047	                            // by the shaper and valid until the next shaping call so
  3048	                            // we can safely use them.
  3049	                            break :cache new_cells;
  3050	                        };
  3051	
  3052	                    // Advance our index until we reach or pass
  3053	                    // our current x position in the shaper cells.
  3054	                    const shaper_cells_unwrapped = shaper_cells.?;
  3055	                    while (run.offset + shaper_cells_unwrapped[shaper_cells_i].x < x) {
  3056	                        shaper_cells_i += 1;
  3057	                    }
  3058	                }
  3059	
  3060	                const wide = cell.wide;
  3061	                const style: terminal.Style = if (cell.hasStyling())
  3062	                    managed_style.*
  3063	                else
  3064	                    .{};
  3065	
  3066	                // True if this cell is selected
  3067	                const selected: enum {
  3068	                    false,
  3069	                    selection,
  3070	                    search,
  3071	                    search_selected,
  3072	                } = selected: {
  3073	                    // Order below matters for precedence.
  3074	
  3075	                    // Selection should take the highest precedence.
  3076	                    const x_compare = if (wide == .spacer_tail)
  3077	                        x -| 1
  3078	                    else
  3079	                        x;
  3080	                    if (selection) |sel| {
  3081	                        if (x_compare >= sel[0] and
  3082	                            x_compare <= sel[1]) break :selected .selection;
  3083	                    }
  3084	
  3085	                    // If we're highlighted, then we're selected. In the
  3086	                    // future we want to use a different style for this
  3087	                    // but this to get started.
  3088	                    for (highlights.items) |hl| {
  3089	                        if (x_compare >= hl.range[0] and
  3090	                            x_compare <= hl.range[1])
  3091	                        {
  3092	                            const tag: HighlightTag = @fromBackingInt(hl.tag);
  3093	                            break :selected switch (tag) {
  3094	                                .search_match => .search,
  3095	                                .search_match_selected => .search_selected,
  3096	                            };
  3097	                        }
  3098	                    }
  3099	
  3100	                    break :selected .false;
  3101	                };
  3102	
  3103	                // The `_style` suffixed values are the colors based on
  3104	                // the cell style (SGR), before applying any additional
  3105	                // configuration, inversions, selections, etc.
  3106	                const bg_style = style.bg(
  3107	                    cell,
  3108	                    &state.colors.palette,
  3109	                );
  3110	                const fg_style = style.fg(.{
  3111	                    .default = state.colors.foreground,
  3112	                    .palette = &state.colors.palette,
  3113	                    .bold = self.config.bold_color,
  3114	                });
  3115	
  3116	                // The final background color for the cell.
  3117	                const bg = switch (selected) {
  3118	                    // If we have an explicit selection background color
  3119	                    // specified in the config, use that.
  3120	                    //
  3121	                    // If no configuration, then our selection background
  3122	                    // is our foreground color.
  3123	                    .selection => if (self.config.selection_background) |v| switch (v) {
  3124	                        .color => |color| color.toTerminalRGB(),
  3125	                        .@"cell-foreground" => if (style.flags.inverse) bg_style else fg_style,
  3126	                        .@"cell-background" => if (style.flags.inverse) fg_style else bg_style,
  3127	                    } else state.colors.foreground,
  3128	
  3129	                    .search => switch (self.config.search_background) {
  3130	                        .color => |color| color.toTerminalRGB(),
  3131	                        .@"cell-foreground" => if (style.flags.inverse) bg_style else fg_style,
  3132	                        .@"cell-background" => if (style.flags.inverse) fg_style else bg_style,
  3133	                    },
  3134	
  3135	                    .search_selected => switch (self.config.search_selected_background) {
  3136	                        .color => |color| color.toTerminalRGB(),
  3137	                        .@"cell-foreground" => if (style.flags.inverse) bg_style else fg_style,
  3138	                        .@"cell-background" => if (style.flags.inverse) fg_style else bg_style,
  3139	                    },
  3140	
  3141	                    // Not selected
  3142	                    .false => if (style.flags.inverse != isCovering(cell.codepoint()))
  3143	                        // Two cases cause us to invert (use the fg color as the bg)
  3144	                        // - The "inverse" style flag.
  3145	                        // - A "covering" glyph; we use fg for bg in that
  3146	                        //   case to help make sure that padding extension
  3147	                        //   works correctly.
  3148	                        //
  3149	                        // If one of these is true (but not the other)
  3150	                        // then we use the fg style color for the bg.
  3151	                        fg_style
  3152	                    else
  3153	                        // Otherwise they cancel out.
  3154	                        bg_style,
  3155	                };
  3156	
  3157	                const fg = fg: {
  3158	                    // Our happy-path non-selection background color
  3159	                    // is our style or our configured defaults.
  3160	                    const final_bg = bg_style orelse state.colors.background;
  3161	
  3162	                    // Whether we need to use the bg color as our fg color:
  3163	                    // - Cell is selected, inverted, and set to cell-foreground
  3164	                    // - Cell is selected, not inverted, and set to cell-background
  3165	                    // - Cell is inverted and not selected
  3166	                    break :fg switch (selected) {
  3167	                        .selection => if (self.config.selection_foreground) |v| switch (v) {
  3168	                            .color => |color| color.toTerminalRGB(),
  3169	                            .@"cell-foreground" => if (style.flags.inverse) final_bg else fg_style,
  3170	                            .@"cell-background" => if (style.flags.inverse) fg_style else final_bg,
  3171	                        } else state.colors.background,
  3172	
  3173	                        .search => switch (self.config.search_foreground) {
  3174	                            .color => |color| color.toTerminalRGB(),
  3175	                            .@"cell-foreground" => if (style.flags.inverse) final_bg else fg_style,
  3176	                            .@"cell-background" => if (style.flags.inverse) fg_style else final_bg,
  3177	                        },
  3178	
  3179	                        .search_selected => switch (self.config.search_selected_foreground) {
  3180	                            .color => |color| color.toTerminalRGB(),
  3181	                            .@"cell-foreground" => if (style.flags.inverse) final_bg else fg_style,
  3182	                            .@"cell-background" => if (style.flags.inverse) fg_style else final_bg,
  3183	                        },
  3184	
  3185	                        .false => if (style.flags.inverse)
  3186	                            final_bg
  3187	                        else
  3188	                            fg_style,
  3189	                    };
  3190	                };
  3191	
  3192	                // Foreground alpha for this cell.
  3193	                const alpha: u8 = if (style.flags.faint) self.config.faint_opacity else 255;
  3194	
  3195	                // Set the cell's background color.
  3196	                {
  3197	                    const rgb = bg orelse state.colors.background;
  3198	
  3199	                    // Determine our background alpha. If we have transparency configured
  3200	                    // then this is dynamic depending on some situations. This is all
  3201	                    // in an attempt to make transparency look the best for various
  3202	                    // situations. See inline comments.
  3203	                    const bg_alpha: u8 = bg_alpha: {
  3204	                        const default: u8 = 255;
  3205	
  3206	                        // Cells that are selected should be fully opaque.
  3207	                        if (selected != .false) break :bg_alpha default;
  3208	
  3209	                        // Cells that are reversed should be fully opaque.
  3210	                        if (style.flags.inverse) break :bg_alpha default;
  3211	
  3212	                        // If the user requested to have opacity on all cells, apply it.
  3213	                        if (self.config.background_opacity_cells and bg_style != null) {
  3214	                            var opacity: f64 = @floatFromInt(default);
  3215	                            opacity *= self.config.background_opacity;
  3216	                            break :bg_alpha @intFromFloat(opacity);
  3217	                        }
  3218	
  3219	                        // Cells that have an explicit bg color should be fully opaque.
  3220	                        if (bg_style != null) break :bg_alpha default;
  3221	
  3222	                        // Otherwise, we won't draw the bg for this cell,
  3223	                        // we'll let the already-drawn background color
  3224	                        // show through.
  3225	                        break :bg_alpha 0;
  3226	                    };
  3227	
  3228	                    self.cells.bgCell(y, x).* = .{
  3229	                        rgb.r, rgb.g, rgb.b, bg_alpha,
  3230	                    };
  3231	                }
  3232	
  3233	                // If the invisible flag is set on this cell then we
  3234	                // don't need to render any foreground elements, so
  3235	                // we just skip all glyphs with this x coordinate.
  3236	                //
  3237	                // NOTE: This behavior matches xterm. Some other terminal
  3238	                // emulators, e.g. Alacritty, still render text decorations
  3239	                // and only make the text itself invisible. The decision
  3240	                // has been made here to match xterm's behavior for this.
  3241	                if (style.flags.invisible) {
  3242	                    continue;
  3243	                }
  3244	
  3245	                // Give links a single underline, unless they already have
  3246	                // an underline, in which case use a double underline to
  3247	                // distinguish them.
  3248	                const underline: terminal.Attribute.Underline = underline: {
  3249	                    if (links.contains(.{
  3250	                        .x = @intCast(x),
  3251	                        .y = @intCast(y),
  3252	                    })) {
  3253	                        break :underline if (style.flags.underline == .single)
  3254	                            .double
  3255	                        else
  3256	                            .single;
  3257	                    }
  3258	                    break :underline style.flags.underline;
  3259	                };
  3260	
  3261	                // We draw underlines first so that they layer underneath text.
  3262	                // This improves readability when a colored underline is used
  3263	                // which intersects parts of the text (descenders).
  3264	                if (underline != .none) self.addUnderline(
  3265	                    @intCast(x),
  3266	                    @intCast(y),
  3267	                    underline,
  3268	                    style.underlineColor(&state.colors.palette) orelse fg,
  3269	                    alpha,
  3270	                ) catch |err| {
  3271	                    log.warn(
  3272	                        "error adding underline to cell, will be invalid x={} y={}, err={}",
  3273	                        .{ x, y, err },
  3274	                    );
  3275	                };
  3276	
  3277	                if (style.flags.overline) self.addOverline(@intCast(x), @intCast(y), fg, alpha) catch |err| {
  3278	                    log.warn(
  3279	                        "error adding overline to cell, will be invalid x={} y={}, err={}",
  3280	                        .{ x, y, err },
  3281	                    );
  3282	                };
  3283	
  3284	                // If we're at or past the end of our shaper run then
  3285	                // we need to get the next run from the run iterator.
  3286	                if (shaper_cells != null and shaper_cells_i >= shaper_cells.?.len) {
  3287	                    shaper_run = try run_iter.next(self.alloc);
  3288	                    shaper_cells = null;
  3289	                    shaper_cells_i = 0;
  3290	                }
  3291	
  3292	                if (shaper_run) |run| glyphs: {
  3293	                    // If we haven't shaped this run yet, do so.
  3294	                    shaper_cells = shaper_cells orelse
  3295	                        // Try to read the cells from the shaping cache if we can.
  3296	                        self.font_shaper_cache.get(run) orelse
  3297	                        cache: {
  3298	                            // Otherwise we have to shape them.
  3299	                            const new_cells = try self.font_shaper.shape(run);
  3300	
  3301	                            // Try to cache them. If caching fails for any reason we
  3302	                            // continue because it is just a performance optimization,
  3303	                            // not a correctness issue.
  3304	                            self.font_shaper_cache.put(
  3305	                                self.alloc,
  3306	                                run,
  3307	                                new_cells,
  3308	                            ) catch |err| {
  3309	                                log.warn(
  3310	                                    "error caching font shaping results err={}",
  3311	                                    .{err},
  3312	                                );
  3313	                            };
  3314	
  3315	                            // The cells we get from direct shaping are always owned
  3316	                            // by the shaper and valid until the next shaping call so
  3317	                            // we can safely use them.
  3318	                            break :cache new_cells;
  3319	                        };
  3320	
  3321	                    const shaped_cells = shaper_cells orelse break :glyphs;
  3322	
  3323	                    // If there are no shaper cells for this run, ignore it.
  3324	                    // This can occur for runs of empty cells, and is fine.
  3325	                    if (shaped_cells.len == 0) break :glyphs;
  3326	
  3327	                    // If we encounter a shaper cell to the left of the current
  3328	                    // cell then we have some problems. This logic relies on x
  3329	                    // position monotonically increasing.
  3330	                    assert(run.offset + shaped_cells[shaper_cells_i].x >= x);
  3331	
  3332	                    // NOTE: An assumption is made here that a single cell will never
  3333	                    // be present in more than one shaper run. If that assumption is
  3334	                    // violated, this logic breaks.
  3335	
  3336	                    while (shaper_cells_i < shaped_cells.len and
  3337	                        run.offset + shaped_cells[shaper_cells_i].x == x) : ({
  3338	                        shaper_cells_i += 1;
  3339	                    }) {
  3340	                        self.addGlyph(
  3341	                            @intCast(x),
  3342	                            @intCast(y),
  3343	                            state.cols,
  3344	                            cells_raw,
  3345	                            shaped_cells[shaper_cells_i],
  3346	                            shaper_run.?,
  3347	                            fg,
  3348	                            alpha,
  3349	                        ) catch |err| {
  3350	                            log.warn(
  3351	                                "error adding glyph to cell, will be invalid x={} y={}, err={}",
  3352	                                .{ x, y, err },
  3353	                            );
  3354	                        };
  3355	                    }
  3356	                }
  3357	
  3358	                // Finally, draw a strikethrough if necessary.
  3359	                if (style.flags.strikethrough) self.addStrikethrough(
  3360	                    @intCast(x),
  3361	                    @intCast(y),
  3362	                    fg,
  3363	                    alpha,
  3364	                ) catch |err| {
  3365	                    log.warn(
  3366	                        "error adding strikethrough to cell, will be invalid x={} y={}, err={}",
  3367	                        .{ x, y, err },
  3368	                    );
  3369	                };
  3370	            }
  3371	        }
  3372	
  3373	        /// Add an underline decoration to the specified cell
  3374	        fn addUnderline(
  3375	            self: *Self,
  3376	            x: terminal.size.CellCountInt,
  3377	            y: terminal.size.CellCountInt,
  3378	            style: terminal.Attribute.Underline,
  3379	            color: terminal.color.RGB,
  3380	            alpha: u8,
  3381	        ) !void {
  3382	            const sprite: font.Sprite = switch (style) {
  3383	                .none => unreachable,
  3384	                .single => .underline,
  3385	                .double => .underline_double,
  3386	                .dotted => .underline_dotted,
  3387	                .dashed => .underline_dashed,
  3388	                .curly => .underline_curly,
  3389	            };
  3390	
  3391	            const render = try self.font_grid.renderGlyph(
  3392	                self.alloc,
  3393	                font.sprite_index,
  3394	                @backingInt(sprite),
  3395	                .{
  3396	                    .cell_width = 1,
  3397	                    .grid_metrics = self.grid_metrics,
  3398	                },
  3399	            );
  3400	
  3401	            try self.cells.add(self.alloc, .underline, .{
  3402	                .atlas = .grayscale,
  3403	                .grid_pos = .{ @intCast(x), @intCast(y) },
  3404	                .color = .{ color.r, color.g, color.b, alpha },
  3405	                .glyph_pos = .{ render.glyph.atlas_x, render.glyph.atlas_y },
  3406	                .glyph_size = .{ render.glyph.width, render.glyph.height },
  3407	                .bearings = .{
  3408	                    @intCast(render.glyph.offset_x),
  3409	                    @intCast(render.glyph.offset_y),
  3410	                },
  3411	            });
  3412	        }
  3413	
  3414	        /// Add a overline decoration to the specified cell
  3415	        fn addOverline(
  3416	            self: *Self,
  3417	            x: terminal.size.CellCountInt,
  3418	            y: terminal.size.CellCountInt,
  3419	            color: terminal.color.RGB,
  3420	            alpha: u8,
  3421	        ) !void {
  3422	            const render = try self.font_grid.renderGlyph(
  3423	                self.alloc,
  3424	                font.sprite_index,
  3425	                @backingInt(font.Sprite.overline),
  3426	                .{
  3427	                    .cell_width = 1,
  3428	                    .grid_metrics = self.grid_metrics,
  3429	                },
  3430	            );
  3431	
  3432	            try self.cells.add(self.alloc, .overline, .{
  3433	                .atlas = .grayscale,
  3434	                .grid_pos = .{ @intCast(x), @intCast(y) },
  3435	                .color = .{ color.r, color.g, color.b, alpha },
  3436	                .glyph_pos = .{ render.glyph.atlas_x, render.glyph.atlas_y },
  3437	                .glyph_size = .{ render.glyph.width, render.glyph.height },
  3438	                .bearings = .{
  3439	                    @intCast(render.glyph.offset_x),
  3440	                    @intCast(render.glyph.offset_y),
  3441	                },
  3442	            });
  3443	        }
  3444	
  3445	        /// Add a strikethrough decoration to the specified cell
  3446	        fn addStrikethrough(
  3447	            self: *Self,
  3448	            x: terminal.size.CellCountInt,
  3449	            y: terminal.size.CellCountInt,
  3450	            color: terminal.color.RGB,
  3451	            alpha: u8,
  3452	        ) !void {
  3453	            const render = try self.font_grid.renderGlyph(
  3454	                self.alloc,
  3455	                font.sprite_index,
  3456	                @backingInt(font.Sprite.strikethrough),
  3457	                .{
  3458	                    .cell_width = 1,
  3459	                    .grid_metrics = self.grid_metrics,
  3460	                },
  3461	            );
  3462	
  3463	            try self.cells.add(self.alloc, .strikethrough, .{
  3464	                .atlas = .grayscale,
  3465	                .grid_pos = .{ @intCast(x), @intCast(y) },
  3466	                .color = .{ color.r, color.g, color.b, alpha },
  3467	                .glyph_pos = .{ render.glyph.atlas_x, render.glyph.atlas_y },
  3468	                .glyph_size = .{ render.glyph.width, render.glyph.height },
  3469	                .bearings = .{
  3470	                    @intCast(render.glyph.offset_x),
  3471	                    @intCast(render.glyph.offset_y),
  3472	                },
  3473	            });
  3474	        }
  3475	
  3476	        // Add a glyph to the specified cell.
  3477	        fn addGlyph(
  3478	            self: *Self,
  3479	            x: terminal.size.CellCountInt,
  3480	            y: terminal.size.CellCountInt,
  3481	            cols: usize,
  3482	            cell_raws: []const terminal.page.Cell,
  3483	            shaper_cell: font.shape.Cell,
  3484	            shaper_run: font.shape.TextRun,
  3485	            color: terminal.color.RGB,
  3486	            alpha: u8,
  3487	        ) !void {
  3488	            const cell = cell_raws[x];
  3489	            const cp = cell.codepoint();
  3490	
  3491	            // Render
  3492	            const render = try self.font_grid.renderGlyph(
  3493	                self.alloc,
  3494	                shaper_run.font_index,
  3495	                shaper_cell.glyph_index,
  3496	                .{
  3497	                    .grid_metrics = self.grid_metrics,
  3498	                    .thicken = self.config.font_thicken,
  3499	                    .thicken_strength = self.config.font_thicken_strength,
  3500	                    .cell_width = cell.gridWidth(),
  3501	                    // If there's no Nerd Font constraint for this codepoint
  3502	                    // then, if it's a symbol, we constrain it to fit inside
  3503	                    // its cell(s), we don't modify the alignment at all.
  3504	                    .constraint = getConstraint(cp) orelse
  3505	                        if (cellpkg.isSymbol(cp)) .{
  3506	                            .size = .fit,
  3507	                        } else .none,
  3508	                    .constraint_width = constraintWidth(
  3509	                        cell_raws,
  3510	                        x,
  3511	                        cols,
  3512	                    ),
  3513	                },
  3514	            );
  3515	
  3516	            // If the glyph is 0 width or height, it will be invisible
  3517	            // when drawn, so don't bother adding it to the buffer.
  3518	            if (render.glyph.width == 0 or render.glyph.height == 0) {
  3519	                return;
  3520	            }
  3521	
  3522	            try self.cells.add(self.alloc, .text, .{
  3523	                .atlas = switch (render.presentation) {
  3524	                    .emoji => .color,
  3525	                    .text => .grayscale,
  3526	                },
  3527	                .bools = .{ .no_min_contrast = noMinContrast(cp) },
  3528	                .grid_pos = .{ @intCast(x), @intCast(y) },
  3529	                .color = .{ color.r, color.g, color.b, alpha },
  3530	                .glyph_pos = .{ render.glyph.atlas_x, render.glyph.atlas_y },
  3531	                .glyph_size = .{ render.glyph.width, render.glyph.height },
  3532	                .bearings = .{
  3533	                    @intCast(render.glyph.offset_x + shaper_cell.x_offset),
  3534	                    @intCast(render.glyph.offset_y + shaper_cell.y_offset),
  3535	                },
  3536	            });
  3537	        }
  3538	
  3539	        fn addCursor(
  3540	            self: *Self,
  3541	            cursor_state: *const terminal.RenderState.Cursor,
  3542	            cursor_style: renderer.CursorStyle,
  3543	            cursor_color: terminal.color.RGB,
  3544	        ) void {
  3545	            const cursor_vp = cursor_state.viewport orelse return;
  3546	
  3547	            // Add the cursor. We render the cursor over the wide character if
  3548	            // we're on the wide character tail.
  3549	            const wide, const x = cell: {
  3550	                // The cursor goes over the screen cursor position.
  3551	                if (!cursor_vp.wide_tail) break :cell .{
  3552	                    cursor_state.cell.wide == .wide,
  3553	                    cursor_vp.x,
  3554	                };
  3555	
  3556	                // If we're part of a wide character, we move the cursor back
  3557	                // to the actual character.
  3558	                break :cell .{ true, cursor_vp.x - 1 };
  3559	            };
  3560	
  3561	            const alpha: u8 = if (!self.focused) 255 else alpha: {
  3562	                const alpha = 255 * self.config.cursor_opacity;
  3563	                break :alpha @intFromFloat(@ceil(alpha));
  3564	            };
  3565	
  3566	            const render = switch (cursor_style) {
  3567	                .block,
  3568	                .block_hollow,
  3569	                .bar,
  3570	                .underline,
  3571	                => render: {
  3572	                    const sprite: font.Sprite = switch (cursor_style) {
  3573	                        .block => .cursor_rect,
  3574	                        .block_hollow => .cursor_hollow_rect,
  3575	                        .bar => .cursor_bar,
  3576	                        .underline => .cursor_underline,
  3577	                        .lock => unreachable,
  3578	                    };
  3579	
  3580	                    break :render self.font_grid.renderGlyph(
  3581	                        self.alloc,
  3582	                        font.sprite_index,
  3583	                        @backingInt(sprite),
  3584	                        .{
  3585	                            .cell_width = if (wide) 2 else 1,
  3586	                            .grid_metrics = self.grid_metrics,
  3587	                        },
  3588	                    ) catch |err| {
  3589	                        log.warn("error rendering cursor glyph err={}", .{err});
  3590	                        return;
  3591	                    };
  3592	                },
  3593	
  3594	                .lock => self.font_grid.renderCodepoint(
  3595	                    self.alloc,
  3596	                    0xF023, // lock symbol
  3597	                    .regular,
  3598	                    .text,
  3599	                    .{
  3600	                        .cell_width = if (wide) 2 else 1,
  3601	                        .grid_metrics = self.grid_metrics,
  3602	                    },
  3603	                ) catch |err| {
  3604	                    log.warn("error rendering cursor glyph err={}", .{err});
  3605	                    return;
  3606	                } orelse {
  3607	                    // This should never happen because we embed nerd
  3608	                    // fonts so we just log and return instead of fallback.
  3609	                    log.warn("failed to find lock symbol for cursor codepoint=0xF023", .{});
  3610	                    return;
  3611	                },
  3612	            };
  3613	
  3614	            self.cells.setCursor(.{
  3615	                .atlas = .grayscale,
  3616	                .bools = .{ .is_cursor_glyph = true },
  3617	                .grid_pos = .{ x, cursor_vp.y },
  3618	                .color = .{ cursor_color.r, cursor_color.g, cursor_color.b, alpha },
  3619	                .glyph_pos = .{ render.glyph.atlas_x, render.glyph.atlas_y },
  3620	                .glyph_size = .{ render.glyph.width, render.glyph.height },
  3621	                .bearings = .{
  3622	                    @intCast(render.glyph.offset_x),
  3623	                    @intCast(render.glyph.offset_y),
  3624	                },
  3625	            }, cursor_style);
  3626	        }
  3627	
  3628	        fn addPreeditCell(
  3629	            self: *Self,
  3630	            cp: renderer.State.Preedit.Codepoint,
  3631	            coord: terminal.Coordinate,
  3632	            screen_fg: terminal.color.RGB,
  3633	        ) !void {
  3634	            // Render the glyph for our preedit text
  3635	            const render_ = self.font_grid.renderCodepoint(
  3636	                self.alloc,
  3637	                @intCast(cp.codepoint),
  3638	                .regular,
  3639	                .text,
  3640	                .{
  3641	                    .grid_metrics = self.grid_metrics,
  3642	                    .thicken = self.config.font_thicken,
  3643	                    .thicken_strength = self.config.font_thicken_strength,
  3644	                },
  3645	            ) catch |err| {
  3646	                log.warn("error rendering preedit glyph err={}", .{err});
  3647	                return;
  3648	            };
  3649	            const render = render_ orelse {
  3650	                log.warn("failed to find font for preedit codepoint={X}", .{cp.codepoint});
  3651	                return;
  3652	            };
  3653	
  3654	            // Add our text
  3655	            try self.cells.add(self.alloc, .text, .{
  3656	                .atlas = .grayscale,
  3657	                .grid_pos = .{ @intCast(coord.x), @intCast(coord.y) },
  3658	                .color = .{ screen_fg.r, screen_fg.g, screen_fg.b, 255 },
  3659	                .glyph_pos = .{ render.glyph.atlas_x, render.glyph.atlas_y },
  3660	                .glyph_size = .{ render.glyph.width, render.glyph.height },
  3661	                .bearings = .{
  3662	                    @intCast(render.glyph.offset_x),
  3663	                    @intCast(render.glyph.offset_y),
  3664	                },
  3665	            });
  3666	
  3667	            // Add underline
  3668	            try self.addUnderline(@intCast(coord.x), @intCast(coord.y), .single, screen_fg, 255);
  3669	            if (cp.wide and coord.x < self.cells.size.columns - 1) {
  3670	                try self.addUnderline(@intCast(coord.x + 1), @intCast(coord.y), .single, screen_fg, 255);
  3671	            }
  3672	        }
  3673	
  3674	        /// Sync the atlas data to the given texture. This copies the bytes
  3675	        /// associated with the atlas to the given texture. If the atlas no
  3676	        /// longer fits into the texture, the texture will be resized.
  3677	        fn syncAtlasTexture(
  3678	            self: *const Self,
  3679	            atlas: *const font.Atlas,
  3680	            texture: *Texture,
  3681	        ) !void {
  3682	            if (atlas.size > texture.width) {
  3683	                // Free our old texture
  3684	                texture.*.deinit();
  3685	
  3686	                // Reallocate
  3687	                texture.* = try self.api.initAtlasTexture(atlas);
  3688	            }
  3689	
  3690	            try texture.replaceRegion(0, 0, atlas.size, atlas.size, atlas.data);
  3691	        }
  3692	    };
  3693	}
