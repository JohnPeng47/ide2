    15	pub const Device = @import("opengl/Device.zig");
    16	
    17	pub const GraphicsAPI = OpenGL;
    18	pub const Target = @import("opengl/Target.zig");
    19	pub const Frame = @import("opengl/Frame.zig");
    20	pub const RenderPass = @import("opengl/RenderPass.zig");
    21	pub const Pipeline = @import("opengl/Pipeline.zig");
    22	const bufferpkg = @import("opengl/buffer.zig");
    23	pub const Buffer = bufferpkg.Buffer;
    24	pub const Sampler = @import("opengl/Sampler.zig");
    25	pub const Texture = @import("opengl/Texture.zig");
    26	pub const shaders = @import("opengl/shaders.zig");
    47	/// The shared render device.
    48	device: *const Device,
    49	
    50	egl_context: *gl.egl.Context,
    51	
    52	pub fn init(
    53	    alloc: Allocator,
    54	    device: *const Device,
    55	    opts: rendererpkg.Options,
    56	) !OpenGL {
    57	    const display = device.display;
    58	
    59	    // Bind to OpenGL API explicitly before we create the context,
    60	    // as otherwise it might fallback to OpenGL ES
    61	    try egl.bindApi(egl.c.EGL_OPENGL_API);
    62	
    63	    // Create our context. Contexts are surface-scoped because a
    64	    // context can only be current on one thread at a time.
    65	    const context = egl.Context.create(display, device.config, null, &.{
    66	        egl.c.EGL_CONTEXT_MAJOR_VERSION,       MIN_VERSION_MAJOR,
    67	        egl.c.EGL_CONTEXT_MINOR_VERSION,       MIN_VERSION_MINOR,
    68	        egl.c.EGL_CONTEXT_OPENGL_PROFILE_MASK, egl.c.EGL_CONTEXT_OPENGL_CORE_PROFILE_BIT,
    69	    }) catch |err| {
    70	        log.warn("failed to create EGL context err={}", .{err});
    71	        return err;
    72	    };
    73	    errdefer context.destroy(display) catch {};
    74	
    75	    display.makeCurrent(null, null, context) catch |err| {
    76	        log.warn("failed to make EGL context current err={}", .{err});
    77	        return err;
    78	    };
    79	
    80	    // Release current so that the main thread
    81	    // doesn't hold onto the GL context forever.
    82	    defer display.releaseCurrent();
    83	
    84	    return .{
    85	        .alloc = alloc,
    86	        .blending = opts.config.blending,
    87	        .device = device,
    88	        .egl_context = context,
    89	    };
    90	}
    91	
    92	pub fn deinit(self: *OpenGL) void {
    93	    self.device.display.releaseCurrent();
    94	    self.egl_context.destroy(self.device.display) catch {};
    95	    self.* = undefined;
    96	}
   217	pub fn surfaceSize(self: *const OpenGL) !struct { width: u32, height: u32 } {
   218	    _ = self;
   219	    var viewport: [4]gl.c.GLint = undefined;
   220	    gl.glad.context.GetIntegerv.?(gl.c.GL_VIEWPORT, &viewport);
   221	    return .{
   222	        .width = @intCast(viewport[2]),
   223	        .height = @intCast(viewport[3]),
   224	    };
   225	}
   227	/// Set the GL viewport to cover the given size in device pixels.
   228	///
   229	/// This used to be automatically called by the GtkGLArea upon resizing,
   230	/// but now we need to do this manually.
   231	pub fn setViewport(self: *const OpenGL, width: u32, height: u32) void {
   232	    _ = self;
   233	    gl.viewport(0, 0, @intCast(width), @intCast(height)) catch |err| {
   234	        log.warn("failed to set OpenGL viewport err={}", .{err});
   235	    };
   236	}
   265	pub fn initTarget(self: *const OpenGL, width: usize, height: usize) !Target {
   266	    _ = self;
   267	    return Target.init(.{
   268	        .width = width,
   269	        .height = height,
   270	    });
   271	}
   272	
   273	/// Export a rendered target. Caller takes ownership
   274	/// of the frame and is responsible for freeing it.
   275	///
   276	/// This runs on the render thread.
   277	pub fn present(
   278	    self: *OpenGL,
   279	    target: Target,
   280	    presentation_health: rendererpkg.Health,
   281	) !ExportedFrame {
   282	    // We only export DMABUFs when the apprt can present them.
   283	    // Otherwise, use CPU buffers.
   284	    if (presentation_health == .healthy) {
   285	        if (target.exportDmabuf(self.device.display, self.egl_context)) |dmabuf| {
   286	            return .{ .dmabuf = dmabuf };
   287	        } else |_| {
   288	            log.warn("failed to export DMABUF, falling back to CPU presentation", .{});
   289	        }
   290	    }
   291	
   292	    return .{ .memory = .{
   293	        .width = @intCast(target.width),
   294	        .height = @intCast(target.height),
   295	        .pixels = try target.readPixelsAlloc(self.alloc),
   296	        .alloc = self.alloc,
   297	    } };
   298	}
   439	pub inline fn beginFrame(
   440	    self: *const OpenGL,
   441	    /// Once the frame has been completed, the `frameCompleted` method
   442	    /// on the renderer is called with the health status of the frame.
   443	    renderer: *Renderer,
   444	    /// The target is presented via the provided renderer's API when completed.
   445	    target: *Target,
   446	) !Frame {
   447	    _ = self;
   448	    return try Frame.begin(.{}, renderer, target);
   449	}
