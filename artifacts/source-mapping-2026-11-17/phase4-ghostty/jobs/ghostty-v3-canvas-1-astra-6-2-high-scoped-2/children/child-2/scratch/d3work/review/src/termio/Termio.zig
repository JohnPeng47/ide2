   254	pub fn init(self: *Termio, alloc: Allocator, opts: termio.Options) !void {
   314	    const handler: StreamHandler = .{
   315	        .alloc = alloc,
   316	        .termio_mailbox = &self.mailbox,
   317	        .surface_mailbox = opts.surface_mailbox,
   318	        .renderer_state = opts.renderer_state,
   319	        .renderer_wakeup = opts.renderer_wakeup,
   320	        .renderer_mailbox = opts.renderer_mailbox,
   321	        .size = &self.size,
   322	        .terminal = &self.terminal,
   335	    self.* = .{
   336	        .alloc = alloc,
   337	        .terminal = term,
   338	        .config = opts.config,
   339	        .renderer_state = opts.renderer_state,
   340	        .renderer_wakeup = opts.renderer_wakeup,
   341	        .renderer_mailbox = opts.renderer_mailbox,
   346	        .terminal_stream = .init(.{
   347	            .allocator = alloc,
   348	            .handler = handler,
   349	        }),
   524	pub fn resize(
   525	    self: *Termio,
   526	    td: *ThreadData,
   527	    size: renderer.Size,
   528	) !void {
   561	    // Mail the renderer so that it can update the GPU and re-render
   562	    _ = self.renderer_mailbox.push(global.io(), .{ .resize = size }, .{ .forever = {} });
   563	    self.renderer_wakeup.notify() catch {};
   564	}
   702	/// Process output from the pty. This is the manual API that users can
   703	/// call with pty data but it is also called by the read thread when using
   704	/// an exec subprocess.
   705	pub fn processOutput(self: *Termio, buf: []const u8) void {
   706	    // We are modifying terminal state from here on out and we need
   707	    // the lock to grab our read data.
   708	    self.renderer_state.mutex.lockUncancelable(global.io());
   709	    defer self.renderer_state.mutex.unlock(global.io());
   710	    self.processOutputLocked(buf);
   711	}
   712	
   713	/// Process output from readdata but the lock is already held.
   714	fn processOutputLocked(self: *Termio, buf: []const u8) void {
   715	    // Schedule a render. We can call this first because we have the lock.
   716	    self.terminal_stream.handler.queueRender() catch unreachable;
   750	            self.terminal_stream.next(byte);
   751	        }
   752	    } else {
   753	        self.terminal_stream.nextSlice(buf);
   754	    }
