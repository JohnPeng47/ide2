    24	/// Begin encoding a frame.
    25	pub fn begin(
    26	    opts: Options,
    27	    /// Once the frame has been completed, the `frameCompleted` method
    28	    /// on the renderer is called with the health status of the frame.
    29	    renderer: *Renderer,
    30	    /// The target is presented via the provided renderer's API when completed.
    31	    target: *Target,
    32	) !Self {
    33	    _ = opts;
    34	
    35	    return .{
    36	        .renderer = renderer,
    37	        .target = target,
    38	    };
    39	}
    40	
    41	/// Add a render pass to this frame with the provided attachments.
    42	/// Returns a RenderPass which allows render steps to be added.
    43	pub inline fn renderPass(
    44	    self: *const Self,
    45	    attachments: []const RenderPass.Options.Attachment,
    46	) RenderPass {
    47	    _ = self;
    48	    return RenderPass.begin(.{ .attachments = attachments });
    49	}
    50	
    51	/// Complete this frame and present the target.
    52	///
    53	/// If `sync` is true, this will block until the frame is presented.
    54	///
    55	/// NOTE: For OpenGL, `sync` is ignored and we never block, instead
    56	/// pushing the newly presented and exported frame to the frame queue.
    57	pub fn complete(self: *const Self, sync: bool) void {
    58	    _ = sync;
    59	
    60	    // If there are any GL errors, consider the frame unhealthy.
    61	    const health: Health = if (gl.errors.getError()) .healthy else |_| .unhealthy;
    62	
    63	    // If the frame is healthy, draw it to an ExportedFrame
    64	    // Then sync before exporting and pushing to the present queue.
    65	    // The apprt pulls from this queue in its snapshot handler.
    66	    const presented_frame: ?OpenGL.ExportedFrame = if (health == .healthy) frame: {
    67	        const frame = self.renderer.api.present(
    68	            self.target.*,
    69	            self.renderer.presentationHealth(),
    70	        ) catch |err| {
    71	            log.warn("failed to present render target: err={}", .{err});
    72	            break :frame null;
    73	        };
    74	        break :frame frame;
    75	    } else null;
    76	
    77	    // Sync after frame draw AND frame present GL calls.
    78	    gl.finish();
    79	
    80	    // At this point the ExportedFrame is finished and can be shared
    81	    if (presented_frame) |frame| {
    82	        self.renderer.pushFrame(frame);
    83	
    84	        // Notify the surface that it should redraw
    85	        _ = self.renderer.surface_mailbox.push(.redraw, .{ .forever = {} });
    86	    }
    87	
    88	    // Report the health to the renderer.
    89	    self.renderer.frameCompleted(health);
    90	}
