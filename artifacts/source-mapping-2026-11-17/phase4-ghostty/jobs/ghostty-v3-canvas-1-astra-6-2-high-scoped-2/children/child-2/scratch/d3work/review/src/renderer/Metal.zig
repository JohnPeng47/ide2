    20	pub const Device = @import("metal/Device.zig");
    21	
    22	pub const GraphicsAPI = Metal;
    23	pub const Target = @import("metal/Target.zig");
    24	pub const Frame = @import("metal/Frame.zig");
    25	pub const RenderPass = @import("metal/RenderPass.zig");
    26	pub const Pipeline = @import("metal/Pipeline.zig");
    27	const bufferpkg = @import("metal/buffer.zig");
    28	pub const Buffer = bufferpkg.Buffer;
    29	pub const Sampler = @import("metal/Sampler.zig");
    30	pub const Texture = @import("metal/Texture.zig");
    31	pub const shaders = @import("metal/shaders.zig");
    42	layer: IOSurfaceLayer,
    43	
    44	/// The shared render device.
    45	device: *const Device,
    46	
    47	/// MTLCommandQueue
    48	queue: objc.Object,
    56	pub fn init(
    57	    alloc: Allocator,
    58	    device: *const Device,
    59	    opts: rendererpkg.Options,
    60	) !Metal {
    61	    comptime switch (builtin.target.os.tag) {
    62	        .macos, .ios => {},
    63	        else => @compileError("unsupported platform for Metal"),
    64	    };
    65	
    66	    _ = alloc;
    67	
    68	    // Create a MTLCommandQueue for our app-scoped MTLDevice.
    69	    const mtl_device = device.device;
    70	    const queue = mtl_device.msgSend(objc.Object, objc.sel("newCommandQueue"), .{});
    71	    errdefer queue.release();
    78	    // Get the metadata about our underlying view that we'll be rendering to.
    79	    const info: ViewInfo = switch (apprt.runtime) {
    80	        apprt.embedded => .{
    81	            .scaleFactor = @floatCast(opts.rt_surface.content_scale.x),
    82	            .view = switch (opts.rt_surface.platform) {
    83	                .macos => |v| v.nsview,
    84	                .ios => |v| v.uiview,
    85	            },
    86	        },
    87	
    88	        else => @compileError("unsupported apprt for metal"),
    89	    };
    90	
    91	    // Create an IOSurfaceLayer which we can assign to the view to make
    92	    // it in to a "layer-hosting view", so that we can manually control
    93	    // the layer contents.
    94	    var layer = try IOSurfaceLayer.init();
    95	    errdefer layer.release();
    96	
    97	    // Add our layer to the view.
    98	    //
    99	    // On macOS we do this by making the view "layer-hosting"
   100	    // by assigning it to the view's `layer` property BEFORE
   101	    // setting `wantsLayer` to `true`.
   102	    //
   103	    // On iOS, views are always layer-backed, and `layer`
   104	    // is readonly, so instead we add it as a sublayer.
   105	    switch (comptime builtin.target.os.tag) {
   106	        .macos => {
   107	            info.view.setProperty("layer", layer.layer.value);
   108	            info.view.setProperty("wantsLayer", true);
   109	        },
   110	
   111	        .ios => {
   112	            const view_layer = objc.Object.fromId(info.view.getProperty(?*anyopaque, "layer"));
   113	            view_layer.msgSend(void, objc.sel("addSublayer:"), .{layer.layer.value});
   114	        },
   115	
   116	        else => @compileError("unsupported target for Metal"),
   117	    }
   128	    // This makes it so that our display callback will actually be called.
   129	    layer.layer.setProperty("needsDisplayOnBoundsChange", true);
   130	
   131	    return .{
   132	        .layer = layer,
   133	        .device = device,
   134	        .queue = queue,
   135	        .blending = opts.config.blending,
   136	    };
   137	}
   138	
   139	pub fn deinit(self: *Metal) void {
   140	    self.queue.release();
   141	
   142	    // The MTLDevice is app-scoped and destroyed
   143	    // by the render device, not by us.
   144	
   145	    self.layer.release();
   146	}
   148	pub fn loopEnter(self: *Metal) void {
   149	    const renderer: *align(1) Renderer = @fieldParentPtr("api", self);
   150	    self.layer.setDisplayCallback(
   151	        @ptrCast(&displayCallback),
   152	        @ptrCast(renderer),
   153	    );
   154	}
   155	
   156	fn displayCallback(renderer: *Renderer) align(8) void {
   157	    renderer.drawFrame(true) catch |err| {
   158	        log.warn("Error drawing frame in display callback, err={}", .{err});
   159	    };
   160	}
   200	pub fn surfaceSize(self: *const Metal) !struct { width: u32, height: u32 } {
   201	    const bounds = self.layer.layer.getProperty(graphics.Rect, "bounds");
   202	    const scale = self.layer.layer.getProperty(f64, "contentsScale");
   203	
   204	    // We need to clamp our runtime surface size to the maximum
   205	    // possible texture size since we can't create a screen buffer (texture)
   206	    // larger than that.
   207	    return .{
   208	        .width = @min(
   209	            @as(u32, @intFromFloat(bounds.size.width * scale)),
   210	            self.device.max_texture_size,
   211	        ),
   212	        .height = @min(
   213	            @as(u32, @intFromFloat(bounds.size.height * scale)),
   214	            self.device.max_texture_size,
   215	        ),
   216	    };
   217	}
   218	
   219	/// Initialize a new render target which can be presented by this API.
   220	pub fn initTarget(self: *const Metal, width: usize, height: usize) !Target {
   221	    return Target.init(.{
   222	        .device = self.device.device,
   223	        // Using an `*_srgb` pixel format makes Metal gamma encode the pixels
   224	        // written to it *after* blending, which means we get linear alpha
   225	        // blending rather than gamma-incorrect blending.
   226	        .pixel_format = if (self.blending.isLinear())
   227	            .bgra8unorm_srgb
   228	        else
   229	            .bgra8unorm,
   230	        .storage_mode = self.device.default_storage_mode,
   231	        .width = width,
   232	        .height = height,
   233	    });
   234	}
   235	
   236	/// Present the provided target.
   237	pub inline fn present(self: *Metal, target: Target, sync: bool) !void {
   238	    if (sync) {
   239	        self.layer.setSurfaceSync(target.surface);
   240	    } else {
   241	        try self.layer.setSurface(target.surface);
   242	    }
   243	}
   378	pub inline fn beginFrame(
   379	    self: *const Metal,
   380	    /// Once the frame has been completed, the `frameCompleted` method
   381	    /// on the renderer is called with the health status of the frame.
   382	    renderer: *Renderer,
   383	    /// The target is presented via the provided renderer's API when completed.
   384	    target: *Target,
   385	) !Frame {
   386	    return try Frame.begin(.{ .queue = self.queue }, renderer, target);
   387	}
