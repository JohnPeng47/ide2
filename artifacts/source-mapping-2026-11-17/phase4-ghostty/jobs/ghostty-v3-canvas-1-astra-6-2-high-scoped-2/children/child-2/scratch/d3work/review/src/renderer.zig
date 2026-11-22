    16	pub const Backend = @import("renderer/backend.zig").Backend;
    17	pub const GenericRenderer = @import("renderer/generic.zig").Renderer;
    18	pub const Metal = @import("renderer/Metal.zig");
    19	pub const OpenGL = @import("renderer/OpenGL.zig");
    20	pub const Options = @import("renderer/Options.zig");
    21	pub const Overlay = @import("renderer/Overlay.zig");
    22	pub const Thread = @import("renderer/Thread.zig");
    23	pub const State = @import("renderer/State.zig");
    35	/// The implementation to use for the renderer. This is comptime chosen
    36	/// so that every build has exactly one renderer implementation.
    37	pub const Renderer = GenericRenderer(GraphicsAPI);
    38	
    39	const GraphicsAPI = switch (build_config.renderer) {
    40	    .metal => Metal,
    41	    .opengl => OpenGL,
    42	};
    43	
    44	/// The app-scoped render device from which surface renderers are created.
    45	pub const Device = GraphicsAPI.Device;
