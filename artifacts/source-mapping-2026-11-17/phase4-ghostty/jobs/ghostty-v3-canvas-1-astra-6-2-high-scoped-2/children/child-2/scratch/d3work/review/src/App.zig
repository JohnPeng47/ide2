    53	/// The set of font GroupCache instances shared by surfaces with the
    54	/// same font configuration.
    55	font_grid_set: font.SharedGridSet,
    57	/// The app-scoped render device, shared by the renderers of all surfaces.
    58	device: ?*renderer.Device,
   123	    var font_grid_set = try font.SharedGridSet.init(alloc);
   124	    errdefer font_grid_set.deinit();
   130	        .font_grid_set = font_grid_set,
   131	        .device = null,
   136	pub fn deinit(self: *App) void {
   137	    // Clean up all our surfaces
   138	    for (self.surfaces.items) |surface| surface.deinit();
   139	    self.surfaces.deinit(self.alloc);
   140	
   141	    // Clean up our font group cache
   142	    // We should have zero items in the grid set at this point because
   143	    // destroy only gets called when the app is shutting down and this
   144	    // should gracefully close all surfaces.
   145	    assert(self.font_grid_set.count() == 0);
   146	    self.font_grid_set.deinit();
   148	    // Clean up our render device. This must happen after all surfaces
   149	    // are gone since their renderers borrow it.
   150	    if (self.device) |dev| dev.deinit(self.alloc);
   151	}
   164	pub fn tick(self: *App, rt_app: *apprt.App) !void {
   165	    // Drain our mailbox
   166	    try self.drainMailbox(rt_app);
   167	}
   273	fn drainMailbox(self: *App, rt_app: *apprt.App) !void {
   274	    while (self.mailbox.pop(global.io())) |message| {
   293	            .surface_message => |msg| try self.surfaceMessage(msg.surface, msg.message),
   532	fn surfaceMessage(self: *App, surface: *Surface, msg: apprt.surface.Message) !void {
   533	    // We want to ensure our window is still active. Window messages
   534	    // are quite rare and we normally don't have many windows so we do
   535	    // a simple linear search here.
   536	    if (self.hasSurface(surface)) {
   537	        try surface.handleMessage(msg);
   538	    }
   539	
   540	    // Window was not found, it probably quit before we handled the message.
   541	    // Not a problem.
   542	}
   605	    pub fn push(self: Mailbox, msg: Message, timeout: Queue.Timeout) Queue.Size {
   606	        const result = self.mailbox.push(global.io(), msg, timeout);
   607	
   608	        // Wake up our app loop
   609	        self.rt_app.wakeup();
   610	
   611	        return result;
   612	    }
