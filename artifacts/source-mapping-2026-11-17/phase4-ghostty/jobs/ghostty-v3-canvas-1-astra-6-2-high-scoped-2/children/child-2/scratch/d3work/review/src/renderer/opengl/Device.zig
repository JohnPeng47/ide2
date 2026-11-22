    37	pub fn init(alloc: Allocator, options: Options) !*Device {
    38	    const self = try alloc.create(Device);
    39	    errdefer alloc.destroy(self);
    40	
    41	    try egl.load();
    42	
    43	    const display = options.display orelse egl.Display.initPlatform(
    44	        egl.c.EGL_PLATFORM_SURFACELESS_MESA,
    45	        egl.c.EGL_DEFAULT_DISPLAY,
    46	        null,
    47	    ) catch |err| {
    48	        if (err == error.BadParameter) logUnsupportedPlatform();
    49	        return err;
    50	    };
    51	
    52	    log.info("EGL vendor={s}", .{display.queryString(.vendor) orelse "(unknown)"});
    53	    log.info("EGL extensions={s}", .{display.queryString(.extensions) orelse "(unknown)"});
    54	
    55	    // Choose a config. We need a config that is renderable with
    56	    // OpenGL and a RGBA8 color buffer.
    57	    const config = egl.Config.choose(display, &.{
    58	        egl.c.EGL_SURFACE_TYPE,    0,
    59	        egl.c.EGL_RENDERABLE_TYPE, egl.c.EGL_OPENGL_BIT,
    60	        egl.c.EGL_RED_SIZE,        8,
    61	        egl.c.EGL_GREEN_SIZE,      8,
    62	        egl.c.EGL_BLUE_SIZE,       8,
    63	        egl.c.EGL_ALPHA_SIZE,      8,
    64	    }) catch |err| {
    65	        log.warn("failed to choose config err={}", .{err});
    66	        return err;
    67	    };
    68	
    69	    self.* = .{
    70	        .display = display,
    71	        .config = config,
    72	    };
    73	    return self;
    74	}
   102	pub fn deinit(self: *Device, alloc: std.mem.Allocator) void {
   103	    // Do not destroy the EGL display as it is externally managed.
   104	    alloc.destroy(self);
   105	}
