    23	///
    24	/// The type used for sending messages to the IO thread. For now this is
    25	/// hardcoded with a capacity. We can make this a comptime parameter in
    26	/// the future if we want it configurable.
    27	pub const Mailbox = BlockingQueue(rendererpkg.Message, 64);
    28	
    29	/// Allocator used for some state
    30	alloc: std.mem.Allocator,
    31	
    32	/// The main event loop for the application. The user data of this loop
    33	/// is always the allocator used to create the loop. This is a convenience
    34	/// so that users of the loop always have an allocator.
    35	loop: xev.Loop,
    36	
    37	/// This can be used to wake up the renderer and force a render safely from
    38	/// any thread.
    39	wakeup: xev.Async,
    40	wakeup_c: xev.Completion = .{},
    41	
    42	/// This can be used to stop the renderer on the next loop iteration.
    43	stop: xev.Async,
    44	stop_c: xev.Completion = .{},
    45	
    46	/// The timer used for animations (custom shaders, Kitty graphics).
    47	/// Normal rendering is driven by wakeup messages instead.
    48	render_h: xev.Timer,
    49	render_c: xev.Completion = .{},
    50	render_c_cancel: xev.Completion = .{},
    51	
    52	/// The kind of work the currently scheduled animation wake needs,
    53	/// stored when the timer is armed.
    54	animation_wake: rendererpkg.Renderer.AnimationWake.Kind = .draw,
    55	
    56	/// This async is used to force a draw immediately. This does not
    57	/// coalesce like the wakeup does.
    58	draw_now: xev.Async,
    59	draw_now_c: xev.Completion = .{},
    60	
    61	/// The timer used for cursor blinking
    62	cursor_h: xev.Timer,
    63	cursor_c: xev.Completion = .{},
    64	cursor_c_cancel: xev.Completion = .{},
    65	
    66	/// Incremental scrollback compression scheduling.
    67	compression: Compression = undefined,
    68	
    69	/// The surface we're rendering to.
    70	surface: *apprt.Surface,
    71	
    72	/// The underlying renderer implementation.
    73	renderer: *rendererpkg.Renderer,
    74	
    75	/// Pointer to the shared state that is used to generate the final render.
    76	state: *rendererpkg.State,
    77	
    78	/// The mailbox that can be used to send this thread messages. Note
    79	/// this is a blocking queue so if it is full you will get errors (or block).
    80	mailbox: *Mailbox,
   116	pub fn init(
   117	    alloc: Allocator,
   118	    config: *const configpkg.Config,
   119	    surface: *apprt.Surface,
   120	    renderer_impl: *rendererpkg.Renderer,
   121	    state: *rendererpkg.State,
   122	) !Thread {
   123	    // Create our event loop.
   124	    var loop = try xev.Loop.init(.{});
   125	    errdefer loop.deinit();
   126	
   127	    // This async handle is used to "wake up" the renderer and force a render.
   128	    var wakeup_h = try xev.Async.init();
   129	    errdefer wakeup_h.deinit();
   130	
   131	    // This async handle is used to stop the loop and force the thread to end.
   132	    var stop_h = try xev.Async.init();
   133	    errdefer stop_h.deinit();
   134	
   135	    // The primary timer for rendering.
   136	    var render_h = try xev.Timer.init();
   137	    errdefer render_h.deinit();
   138	
   139	    // Draw now async, see comments.
   140	    var draw_now = try xev.Async.init();
   141	    errdefer draw_now.deinit();
   142	
   143	    // Setup a timer for blinking the cursor
   144	    var cursor_timer = try xev.Timer.init();
   145	    errdefer cursor_timer.deinit();
   146	
   147	    // The mailbox for messaging this thread
   148	    var mailbox = try Mailbox.create(alloc);
   149	    errdefer mailbox.destroy(alloc);
   150	
   151	    var result: Thread = .{
   152	        .alloc = alloc,
   153	        .config = .init(config),
   154	        .loop = loop,
   155	        .wakeup = wakeup_h,
   156	        .stop = stop_h,
   157	        .render_h = render_h,
   158	        .draw_now = draw_now,
   159	        .cursor_h = cursor_timer,
   160	        .surface = surface,
   161	        .renderer = renderer_impl,
   162	        .state = state,
   163	        .mailbox = mailbox,
   164	    };
   165	
   166	    // Only enable compression if we have it enabled... save some
   167	    // minor resources.
   168	    if (comptime terminalpkg.compression_enabled) {
   169	        result.compression = try .init();
   170	    }
   171	
   172	    return result;
   173	}
   175	/// Clean up the thread. This is only safe to call once the thread
   176	/// completes executing; the caller must join prior to this.
   177	pub fn deinit(self: *Thread) void {
   178	    self.stop.deinit();
   179	    self.wakeup.deinit();
   180	    self.render_h.deinit();
   181	    self.draw_now.deinit();
   182	    self.cursor_h.deinit();
   183	    if (comptime terminalpkg.compression_enabled)
   184	        self.compression.deinit();
   185	    self.loop.deinit();
   186	
   187	    // Nothing can possibly access the mailbox anymore, destroy it.
   188	    self.mailbox.destroy(self.alloc);
   189	}
   191	/// The main entrypoint for the thread.
   192	pub fn threadMain(self: *Thread) void {
   193	    // Call child function so we can use errors...
   194	    self.threadMain_() catch |err| {
   195	        // In the future, we should expose this on the thread struct.
   196	        log.warn("error in renderer err={}", .{err});
   197	    };
   198	}
   199	
   200	fn threadMain_(self: *Thread) !void {
   201	    defer log.debug("renderer thread exited", .{});
   202	
   203	    // Right now, on Darwin, `std.Thread.setName` can only name the current
   204	    // thread, and we have no way to get the current thread from within it,
   205	    // so instead we use this code to name the thread instead.
   206	    if (builtin.target.os.tag.isDarwin()) {
   207	        internal_os.macos.pthread_setname_np(&"renderer".*);
   208	    }
   209	
   210	    // Setup our crash metadata
   211	    crash.sentry.thread_state = .{
   212	        .type = .renderer,
   213	        .surface = self.renderer.surface_mailbox.surface,
   214	    };
   215	    defer crash.sentry.thread_state = null;
   216	
   217	    // Setup our thread QoS
   218	    self.setQosClass();
   219	
   220	    // Run our loop start/end callbacks if the renderer cares.
   221	    const has_loop = @hasDecl(rendererpkg.Renderer, "loopEnter");
   222	    if (has_loop) try self.renderer.loopEnter(self);
   223	    defer if (has_loop) self.renderer.loopExit();
   224	
   225	    // Run our thread start/end callbacks. This is important because some
   226	    // renderers have to do per-thread setup. For example, OpenGL has to set
   227	    // some thread-local state since that is how it works.
   228	    try self.renderer.threadEnter(self.surface);
   229	    defer self.renderer.threadExit();
   230	
   231	    // Start the async handlers
   232	    self.wakeup.wait(&self.loop, &self.wakeup_c, Thread, self, wakeupCallback);
   233	    self.stop.wait(&self.loop, &self.stop_c, Thread, self, stopCallback);
   234	    self.draw_now.wait(&self.loop, &self.draw_now_c, Thread, self, drawNowCallback);
   235	
   236	    // Send an initial wakeup message so that we render right away.
   237	    try self.wakeup.notify();
   238	
   239	    // Start blinking the cursor.
   240	    self.cursor_h.run(
   241	        &self.loop,
   242	        &self.cursor_c,
   243	        cursorBlinkInterval(),
   244	        Thread,
   245	        self,
   246	        cursorTimerCallback,
   247	    );
   248	
   249	    // Arm the animation timer in case the renderer already needs
   250	    // animation wakes (e.g. custom shaders loaded at startup).
   251	    self.armAnimationTimer();
   252	
   253	    // Run
   254	    log.debug("starting renderer thread", .{});
   255	    defer log.debug("starting renderer thread shutdown", .{});
   256	    _ = try self.loop.run(.until_done);
   257	}
   290	fn drainMailbox(self: *Thread) !void {
   291	    // There's probably a more elegant way to do this...
   292	    //
   293	    // This is effectively an @autoreleasepool{} block, which we need in
   294	    // order to ensure that autoreleased objects are properly released.
   295	    const pool = if (builtin.target.os.tag.isDarwin())
   296	        @import("objc").AutoreleasePool.init()
   297	    else
   298	        void;
   299	    defer if (builtin.target.os.tag.isDarwin()) pool.deinit();
   300	
   301	    while (self.mailbox.pop(global.io())) |message| {
   302	        log.debug("mailbox message={}", .{message});
   303	        switch (message) {
   304	            .crash => @panic("crash request, crashing intentionally"),
   305	
   306	            .visible => |v| visible: {
   307	                // If our state didn't change we do nothing.
   308	                if (self.flags.visible == v) break :visible;
   309	
   310	                // Set our visible state
   311	                self.flags.visible = v;
   312	
   313	                // Visibility affects our QoS class
   314	                self.setQosClass();
   315	
   316	                // If we became visible then we immediately rebuild cells
   317	                // (renderCallback skips updateFrame while invisible) and
   318	                // draw. Going through renderCallback also reschedules
   319	                // any Kitty graphics animation wakeup that lapsed
   320	                // while we were invisible.
   321	                if (v) _ = renderCallback(self, undefined, undefined, {});
   322	
   323	                // Notify the renderer so it can update any state.
   324	                self.renderer.setVisible(v);
   325	
   326	                // Note that we're explicitly today not stopping any
   327	                // cursor timers, draw timers, etc. These things have very
   328	                // little resource cost and properly maintaining their active
   329	                // state across different transitions is going to be bug-prone,
   330	                // so its easier to just let them keep firing and have them
   331	                // check the visible state themselves to control their behavior.
   332	            },
   333	
   334	            .focus => |v| focus: {
   335	                // If our state didn't change we do nothing.
   336	                if (self.flags.focused == v) break :focus;
   337	
   338	                // Set our state
   339	                self.flags.focused = v;
   340	
   341	                // Focus affects our QoS class
   342	                self.setQosClass();
   343	
   344	                // Set it on the renderer
   345	                try self.renderer.setFocus(v);
   346	
   347	                // Focus gates custom shader animation, so re-arm
   348	                // the animation timer for the new state.
   349	                self.armAnimationTimer();
   350	
   351	                if (!v) {
   352	                    // If we're not focused, then we stop the cursor blink
   353	                    if (self.cursor_c.state() == .active and
   354	                        self.cursor_c_cancel.state() == .dead)
   355	                    {
   356	                        self.cursor_h.cancel(
   357	                            &self.loop,
   358	                            &self.cursor_c,
   359	                            &self.cursor_c_cancel,
   360	                            void,
   361	                            null,
   362	                            cursorCancelCallback,
   363	                        );
   364	                    }
   365	                } else {
   366	                    // If we're focused, we immediately show the cursor again
   367	                    // and then restart the timer.
   368	                    if (self.cursor_c.state() != .active) {
   369	                        self.flags.cursor_blink_visible = true;
   370	                        self.cursor_h.run(
   371	                            &self.loop,
   372	                            &self.cursor_c,
   373	                            cursorBlinkInterval(),
   374	                            Thread,
   375	                            self,
   376	                            cursorTimerCallback,
   377	                        );
   378	                    }
   379	                }
   380	            },
   381	
   382	            .reset_cursor_blink => {
   383	                self.flags.cursor_blink_visible = true;
   384	                if (self.cursor_c.state() == .active) {
   385	                    self.cursor_h.reset(
   386	                        &self.loop,
   387	                        &self.cursor_c,
   388	                        &self.cursor_c_cancel,
   389	                        cursorBlinkInterval(),
   390	                        Thread,
   391	                        self,
   392	                        cursorTimerCallback,
   393	                    );
   394	                }
   395	            },
   396	
   397	            .font_grid => |grid| {
   398	                self.renderer.setFontGrid(grid.grid);
   399	                grid.set.deref(grid.old_key);
   400	            },
   401	
   402	            .presentation_health => |v| self.renderer.setPresentationHealth(v),
   403	
   404	            .resize => |v| self.renderer.setScreenSize(v),
   405	
   406	            .change_config => |config| {
   407	                defer config.alloc.destroy(config.thread);
   408	                defer config.alloc.destroy(config.impl);
   409	                try self.changeConfig(config.thread);
   410	                try self.renderer.changeConfig(config.impl);
   411	
   412	                // The config affects what animation wakes the
   413	                // renderer needs (custom shaders, animation mode).
   414	                self.armAnimationTimer();
   415	            },
   416	
   417	            .search_viewport_matches => |v| {
   418	                // Note we don't free the new value because we expect our
   419	                // allocators to match.
   420	                if (self.renderer.search_matches) |*m| m.arena.deinit();
   421	                self.renderer.search_matches = v;
   422	                self.renderer.search_matches_dirty = true;
   423	            },
   424	
   425	            .search_selected_match => |v| {
   426	                // Note we don't free the new value because we expect our
   427	                // allocators to match.
   428	                if (self.renderer.search_selected_match) |*m| m.arena.deinit();
   429	                self.renderer.search_selected_match = v;
   430	                self.renderer.search_matches_dirty = true;
   431	            },
   432	
   433	            .inspector => |v| {
   434	                self.flags.has_inspector = v;
   435	            },
   436	
   437	            .macos_display_id => |v| {
   438	                if (@hasDecl(rendererpkg.Renderer, "setMacOSDisplayID")) {
   439	                    try self.renderer.setMacOSDisplayID(v, &self.draw_now);
   440	                }
   441	            },
   442	        }
   443	    }
   444	}
   462	fn drawFrame(self: *Thread, now: bool) void {
   463	    // If we're invisible, we do not draw.
   464	    if (!self.flags.visible) return;
   465	
   466	    // If the renderer is managing a vsync on its own, we only draw
   467	    // when we're forced to via `now`.
   468	    if (!now and self.renderer.hasVsync()) return;
   469	
   470	    self.renderer.drawFrame(false) catch |err|
   471	        log.warn("error drawing err={}", .{err});
   472	}
   473	
   474	fn wakeupCallback(
   475	    self_: ?*Thread,
   476	    _: *xev.Loop,
   477	    _: *xev.Completion,
   478	    r: xev.Async.WaitError!void,
   479	) xev.CallbackAction {
   480	    _ = r catch |err| {
   481	        log.err("error in wakeup err={}", .{err});
   482	        return .rearm;
   483	    };
   484	
   485	    const t = self_.?;
   486	
   487	    // When we wake up, we check the mailbox. Mailbox producers should
   488	    // wake up our thread after publishing.
   489	    t.drainMailbox() catch |err|
   490	        log.err("error draining mailbox err={}", .{err});
   491	
   492	    // Render immediately
   493	    _ = renderCallback(t, undefined, undefined, {});
   494	
   495	    // PageList mutations maintain their own compression dirty state. Checking
   496	    // it here covers output, resize, and viewport scrolling uniformly.
   497	    t.compression.wake(t);
   519	fn drawNowCallback(
   520	    self_: ?*Thread,
   521	    _: *xev.Loop,
   522	    _: *xev.Completion,
   523	    r: xev.Async.WaitError!void,
   524	) xev.CallbackAction {
   525	    _ = r catch |err| {
   526	        log.err("error in draw now err={}", .{err});
   527	        return .rearm;
   528	    };
   529	
   530	    // Draw immediately
   531	    const t = self_.?;
   532	    t.drawFrame(true);
   533	
   534	    return .rearm;
   535	}
   536	
   537	fn renderCallback(
   538	    self_: ?*Thread,
   539	    _: *xev.Loop,
   540	    _: *xev.Completion,
   541	    r: xev.Timer.RunError!void,
   542	) xev.CallbackAction {
   543	    _ = r catch |err| switch (err) {
   544	        // Sent when a scheduled animation wakeup is superseded by a
   545	        // newer one (Timer.reset cancels the pending run). Nothing to
   546	        // do; the replacement timer carries on.
   547	        error.Canceled => return .disarm,
   548	        else => unreachable,
   549	    };
   550	    const t: *Thread = self_ orelse {
   551	        // This shouldn't happen so we log it.
   552	        log.warn("render callback fired without data set", .{});
   553	        return .disarm;
   554	    };
   555	
   556	    // If the display is now unrealized, release GPU resources now
   557	    // we're on the render thread, and do not try to update and draw
   558	    // this frame.
   559	    if (!t.renderer.display_realized) {
   560	        t.renderer.draw_mutex.lockUncancelable(global.io());
   561	        defer t.renderer.draw_mutex.unlock(global.io());
   562	
   563	        t.renderer.releaseGpuResources();
   564	        return .disarm;
   565	    }
   566	
   567	    // If we're not visible there's no point spending CPU rebuilding cells —
   568	    // we'll catch up when the .visible mailbox message flips us back on.
   569	    // Kitty graphics animations pause with us and resume on visibility.
   570	    if (!t.flags.visible) return .disarm;
   571	
   572	    // Update our frame data
   573	    t.renderer.updateFrame(
   574	        t.state,
   575	        t.flags.cursor_blink_visible,
   576	    ) catch |err|
   577	        log.warn("error rendering err={}", .{err});
   578	
   579	    // Draw
   580	    t.drawFrame(false);
   581	
   582	    // Schedule the next animation wake, if the renderer needs one.
   583	    t.armAnimationTimer();
   584	
   585	    return .disarm;
   586	}
   596	fn armAnimationTimer(self: *Thread) void {
   597	    const wake = self.renderer.animationWake() orelse return;
   598	    self.animation_wake = wake.kind;
   599	    self.render_h.reset(
   600	        &self.loop,
   601	        &self.render_c,
   602	        &self.render_c_cancel,
   603	        wake.delay_ms,
   604	        Thread,
   605	        self,
   606	        animationTimerCallback,
   607	    );
   608	}
   609	
   610	fn animationTimerCallback(
   611	    self_: ?*Thread,
   612	    _: *xev.Loop,
   613	    _: *xev.Completion,
   614	    r: xev.Timer.RunError!void,
   615	) xev.CallbackAction {
   616	    _ = r catch |err| switch (err) {
   617	        // Sent when a scheduled animation wake is superseded by a
   618	        // newer one (Timer.reset cancels the pending run). Nothing to
   619	        // do; the replacement timer carries on.
   620	        error.Canceled => return .disarm,
   621	        else => unreachable,
   622	    };
   623	    const t: *Thread = self_ orelse {
   624	        // This shouldn't happen so we log it.
   625	        log.warn("animation callback fired without data set", .{});
   626	        return .disarm;
   627	    };
   628	
   629	    // Animations pause entirely while we're invisible; the .visible
   630	    // mailbox message re-arms us when we can be seen again.
   631	    if (!t.flags.visible) return .disarm;
   632	
   633	    switch (t.animation_wake) {
   634	        // Frame data must be updated (a Kitty animation frame is
   635	        // due). renderCallback updates, draws, and re-arms us.
   636	        .update => return renderCallback(
   637	            t,
   638	            undefined,
   639	            undefined,
   640	            {},
   641	        ),
   642	
   643	        // A redraw alone suffices (custom shader time uniform).
   644	        // Draw calls don't update from the terminal state so they
   645	        // are much cheaper than a frame update.
   646	        .draw => {
   647	            t.drawFrame(false);
   648	            t.armAnimationTimer();
   649	            return .disarm;
   650	        },
   651	    }
   652	}
   654	fn cursorTimerCallback(
   655	    self_: ?*Thread,
   656	    _: *xev.Loop,
   657	    _: *xev.Completion,
   658	    r: xev.Timer.RunError!void,
   659	) xev.CallbackAction {
   660	    _ = r catch |err| switch (err) {
   661	        // This is sent when our timer is canceled. That's fine.
   662	        error.Canceled => return .disarm,
   663	
   664	        else => {
   665	            log.warn("error in cursor timer callback err={}", .{err});
   666	            unreachable;
   667	        },
   668	    };
   669	
   670	    const t: *Thread = self_ orelse {
   671	        // This shouldn't happen so we log it.
   672	        log.warn("render callback fired without data set", .{});
   673	        return .disarm;
   674	    };
   675	
   676	    t.flags.cursor_blink_visible = !t.flags.cursor_blink_visible;
   677	    t.wakeup.notify() catch {};
   678	
   679	    t.cursor_h.run(
   680	        &t.loop,
   681	        &t.cursor_c,
   682	        cursorBlinkInterval(),
   683	        Thread,
   684	        t,
   685	        cursorTimerCallback,
   686	    );
   687	    return .disarm;
   688	}
   722	fn stopCallback(
   723	    self_: ?*Thread,
   724	    _: *xev.Loop,
   725	    _: *xev.Completion,
   726	    r: xev.Async.WaitError!void,
   727	) xev.CallbackAction {
   728	    _ = r catch unreachable;
   729	    self_.?.loop.stop();
   730	    return .disarm;
   731	}
   749	/// Schedules incremental terminal compression after renderer activity stops.
   750	///
   751	/// This owns all renderer-specific compression state. The terminal decides
   752	/// when compression-relevant activity changes and performs the actual work;
   753	/// the renderer only provides idle scheduling and avoids waiting for the
   754	/// terminal lock.
   755	const Compression = struct {
   756	    const idle_interval = 250;
   757	    const step_interval = 1;
   758	
   759	    timer: xev.Timer,
   760	    completion: xev.Completion = .{},
   761	    reset_completion: xev.Completion = .{},
   762	    activity: ?u64 = null,
   763	
   764	    fn init() !Compression {
   765	        return .{ .timer = try xev.Timer.init() };
   766	    }
   767	
   768	    fn deinit(self: *Compression) void {
   769	        self.timer.deinit();
   770	    }
   771	
   772	    /// Start or postpone compression after a renderer wake.
   773	    fn wake(self: *Compression, thread: *Thread) void {
   774	        // If we have no compression then don't do anything.
   775	        if (comptime !terminalpkg.compression_enabled) return;
   776	        if (!thread.config.scrollback_compression) return;
   777	
   778	        // PageList activity, rather than a generic renderer wake, restarts the
   779	        // idle interval. In particular, the inspector wakes the renderer every
   780	        // frame without changing terminal contents and must not starve this
   781	        // timer indefinitely.
   782	        if (thread.state.mutex.tryLock()) {
   783	            defer thread.state.mutex.unlock(global.io());
   784	            const activity = thread.state.terminal.compressionActivity();
   785	            if (self.activity == activity) return;
   786	            self.activity = activity;
   787	        } else if (self.completion.state() == .active) {
   788	            // Contention doesn't prove that compression-relevant activity
   789	            // changed. Keep an existing deadline so frequent inspector frames
   790	            // cannot postpone compression forever. The timer rechecks both the
   791	            // activity token and lock availability before doing any work.
   792	            return;
   793	        }
   794	
   795	        // Contention may mean parsing is active. Scheduling is a harmless
   796	        // false positive when no compression work is actually pending, but is
   797	        // necessary when no timer is already active.
   798	        self.schedule(thread, idle_interval);
   799	    }
   800	
   801	    /// Start the one-shot timer, or move its deadline if it is already active.
   802	    fn schedule(self: *Compression, thread: *Thread, delay_ms: u64) void {
   803	        self.timer.reset(
   804	            &thread.loop,
   805	            &self.completion,
   806	            &self.reset_completion,
   807	            delay_ms,
   808	            Thread,
   809	            thread,
   810	            timerCallback,
   811	        );
   812	    }
   813	
   814	    fn timerCallback(
   815	        thread_: ?*Thread,
   816	        _: *xev.Loop,
   817	        _: *xev.Completion,
   818	        result: xev.Timer.RunError!void,
   819	    ) xev.CallbackAction {
   820	        _ = result catch |err| switch (err) {
   821	            error.Canceled => return .disarm,
   822	            else => {
   823	                log.warn("error in compression timer err={}", .{err});
   824	                return .disarm;
   825	            },
   826	        };
   827	
   828	        const thread = thread_ orelse return .disarm;
   829	        const self = &thread.compression;
   830	
   831	        if (self.step(thread)) |delay| self.schedule(thread, delay);
   832	        return .disarm;
   833	    }
   834	
   835	    /// Try one bounded step without waiting for the terminal lock. The return
   836	    /// value is the delay before another attempt, or null when work is done.
   837	    fn step(self: *Compression, thread: *Thread) ?u64 {
   838	        if (!thread.config.scrollback_compression) return null;
   839	
   840	        const state = thread.state;
   841	        if (!state.mutex.tryLock()) return idle_interval;
   842	        defer state.mutex.unlock(global.io());
   843	
   844	        const activity = state.terminal.compressionActivity();
   845	        if (self.activity != activity) {
   846	            self.activity = activity;
   847	            return idle_interval;
   848	        }
   849	
   850	        return switch (state.terminal.compress(.incremental)) {
   851	            .pending => step_interval,
   852	            .unsupported,
   853	            .complete,
   854	            => null,
   855	        };
   856	    }
   857	};
