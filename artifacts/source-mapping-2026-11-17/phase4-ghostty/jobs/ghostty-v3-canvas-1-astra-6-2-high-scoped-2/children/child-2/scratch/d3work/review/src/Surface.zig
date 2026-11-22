    44	// The renderer implementation to use.
    45	const Renderer = rendererpkg.Renderer;
    92	/// The renderer for this surface.
    93	renderer: Renderer,
    94	
    95	/// The render state
    96	renderer_state: rendererpkg.State,
    97	
    98	/// The renderer thread manager
    99	renderer_thread: rendererpkg.Thread,
   100	
   101	/// The actual thread
   102	renderer_thr: std.Thread,
   477	pub fn init(
   478	    self: *Surface,
   479	    alloc: Allocator,
   480	    config_original: *const configpkg.Config,
   481	    app: *App,
   482	    rt_app: *apprt.runtime.App,
   483	    rt_surface: *apprt.runtime.Surface,
   484	) !void {
   528	    // Setup our font group. This will reuse an existing font group if
   529	    // it was already loaded.
   530	    const font_grid_key, const font_grid = try app.font_grid_set.ref(
   531	        &derived_config.font,
   532	        font_size,
   533	    );
   534	    errdefer app.font_grid_set.deref(font_grid_key);
   564	    // Initialize the render device if it hasn't been initialized already
   565	    const render_device = app.device orelse device: {
   566	        const device_options = try rt_surface.renderDeviceOptions();
   567	        const device: *rendererpkg.Device = try .init(alloc, device_options);
   568	        app.device = device;
   569	        break :device device;
   570	    };
   574	    var renderer_impl = renderer: {
   575	        // Renderer.init takes ownership of the config only on success, after
   576	        // which the errdefer below frees it, so this errdefer must end here.
   577	        var renderer_config = try Renderer.DerivedConfig.init(alloc, config);
   578	        errdefer renderer_config.deinit();
   579	
   580	        break :renderer try Renderer.init(alloc, .{
   581	            .device = render_device,
   582	            .config = renderer_config,
   583	            .font_grid = font_grid,
   584	            .size = size,
   585	            .surface_mailbox = .{ .surface = self, .app = app_mailbox },
   586	            .rt_surface = rt_surface,
   587	            .thread = &self.renderer_thread,
   588	        });
   589	    };
   590	    errdefer renderer_impl.deinit();
   591	
   592	    // The mutex used to protect our renderer state.
   593	    const mutex = try alloc.create(std.Io.Mutex);
   594	    mutex.* = .init;
   595	    errdefer alloc.destroy(mutex);
   596	
   597	    // Create the renderer thread
   598	    var render_thread = try rendererpkg.Thread.init(
   599	        alloc,
   600	        config,
   601	        rt_surface,
   602	        &self.renderer,
   603	        &self.renderer_state,
   604	    );
   605	    errdefer render_thread.deinit();
   624	        .app = app,
   625	        .rt_app = rt_app,
   626	        .rt_surface = rt_surface,
   627	        .font_grid_key = font_grid_key,
   628	        .font_size = font_size,
   629	        .font_size_adjusted = false,
   630	        .font_metrics = font_grid.metrics,
   631	        .renderer = renderer_impl,
   632	        .renderer_thread = render_thread,
   633	        .renderer_state = .{
   634	            .mutex = mutex,
   635	            .terminal = &self.io.terminal,
   636	        },
   637	        .renderer_thr = undefined,
   717	            .renderer_state = &self.renderer_state,
   718	            .renderer_wakeup = render_thread.wakeup,
   719	            .renderer_mailbox = render_thread.mailbox,
   753	    // Start our renderer thread
   754	    self.renderer_thr = try std.Thread.spawn(
   755	        .{},
   756	        rendererpkg.Thread.threadMain,
   757	        .{&self.renderer_thread},
   758	    );
   759	    self.renderer_thr.setName(global.io(), "renderer") catch {};
   829	pub fn deinit(self: *Surface) void {
   833	    // Stop rendering thread
   834	    {
   835	        self.renderer_thread.stop.notify() catch |err|
   836	            log.err("error notifying renderer thread to stop, may stall err={}", .{err});
   837	        self.renderer_thr.join();
   838	    }
   847	    // We need to deinit AFTER everything is stopped, since there are
   848	    // shared values between the two threads.
   849	    //
   850	    // The renderer must be deinitialized before the renderer thread:
   851	    // on macOS the renderer's display link callback points at the
   852	    // thread's `draw_now` handle, and the renderer's deinit is what
   853	    // stops the display link for good.
   854	    self.renderer.deinit();
   855	    self.renderer_thread.deinit();
   870	    // Clean up our font grid
   871	    self.app.font_grid_set.deref(self.font_grid_key);
   922	/// Forces the surface to render. This is useful for when the surface
   923	/// is in the middle of animation (such as a resize, etc.) or when
   924	/// the render timer is managed manually by the apprt.
   925	pub fn draw(self: *Surface) !void {
   926	    // Renderers are required to support `drawFrame` being called from
   927	    // the main thread, so that they can update contents during resize.
   928	    try self.renderer.drawFrame(true);
   929	}
  1017	pub fn handleMessage(self: *Surface, msg: Message) !void {
  1154	        .redraw => self.redraw(),
  1779	fn redraw(self: *Surface) void {
  1780	    _ = self.rt_app.performAction(
  1781	        .{ .surface = self },
  1782	        .render,
  1783	        {},
  1784	    ) catch |err| {
  1785	        log.warn("failed to notify app of frame present err={}", .{err});
  1786	    };
  1787	}
  2536	pub fn setFontSize(self: *Surface, size: font.face.DesiredSize) !void {
  2537	    log.debug("set font size size={}", .{size.points});
  2538	
  2539	    // Update our font size so future changes work
  2540	    self.font_size = size;
  2541	
  2542	    // We need to build up a new font stack for this font size.
  2543	    const font_grid_key, const font_grid = try self.app.font_grid_set.ref(
  2544	        &self.config.font,
  2545	        self.font_size,
  2546	    );
  2547	    errdefer self.app.font_grid_set.deref(font_grid_key);
  2555	    // Notify our render thread of the new font stack. The renderer
  2556	    // MUST accept the new font grid and deref the old.
  2557	    _ = self.renderer_thread.mailbox.push(global.io(), .{
  2558	        .font_grid = .{
  2559	            .grid = font_grid,
  2560	            .set = &self.app.font_grid_set,
  2561	            .old_key = self.font_grid_key,
  2562	            .new_key = font_grid_key,
  2563	        },
  2564	    }, .{ .forever = {} });
  2565	
  2566	    // Once we've sent the key we can replace our key
  2567	    self.font_grid_key = font_grid_key;
  2568	    self.font_metrics = font_grid.metrics;
  2569	
  2570	    // Schedule render which also drains our mailbox
  2571	    self.queueRender() catch unreachable;
  2572	}
  2577	fn queueRender(self: *Surface) !void {
  2578	    try self.renderer_thread.wakeup.notify();
  2579	}
  2618	fn resize(self: *Surface, size: rendererpkg.ScreenSize) !void {
  2640	    // Mail the render thread so it updates its padding and screen size.
  2641	    _ = self.renderer_thread.mailbox.push(
  2642	        global.io(),
  2643	        .{ .resize = self.size },
  2644	        .forever,
  2645	    );
  2646	    self.queueRender() catch |err| {
  2647	        log.warn("failed to notify renderer of resize err={}", .{err});
  2648	    };
  2649	}
