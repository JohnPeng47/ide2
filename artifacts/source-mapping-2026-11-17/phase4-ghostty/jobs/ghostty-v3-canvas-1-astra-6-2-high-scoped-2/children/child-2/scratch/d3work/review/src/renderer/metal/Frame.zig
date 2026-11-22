    29	/// Begin encoding a frame.
    30	pub fn begin(
    31	    opts: Options,
    32	    /// Once the frame has been completed, the `frameCompleted` method
    33	    /// on the renderer is called with the health status of the frame.
    34	    renderer: *Renderer,
    35	    /// The target is presented via the provided renderer's API when completed.
    36	    target: *Target,
    37	) !Self {
    38	    const buffer = opts.queue.msgSend(
    39	        objc.Object,
    40	        objc.sel("commandBuffer"),
    41	        .{},
    42	    );
    43	
    44	    // Create our block to register for completion updates.
    45	    // The block is deallocated by the objC runtime on success.
    46	    const block = CompletionBlock.init(
    47	        .{
    48	            .renderer = renderer,
    49	            .target = target,
    50	            .sync = false,
    51	        },
    52	        &bufferCompleted,
    53	    );
    54	
    55	    return .{ .buffer = buffer, .block = block };
    56	}
    67	fn bufferCompleted(
    68	    block: *const CompletionBlock.Context,
    69	    buffer_id: objc.c.id,
    70	) callconv(.c) void {
    71	    const buffer = objc.Object.fromId(buffer_id);
    72	
    73	    // Get our command buffer status to pass back to the generic renderer.
    74	    const status = buffer.getProperty(mtl.MTLCommandBufferStatus, "status");
    75	    const health: Health = switch (status) {
    76	        .@"error" => .unhealthy,
    77	        else => .healthy,
    78	    };
    79	
    80	    // If the frame is healthy, present it.
    81	    if (health == .healthy) {
    82	        block.renderer.api.present(
    83	            block.target.*,
    84	            block.sync,
    85	        ) catch |err| {
    86	            log.err("Failed to present render target: err={}", .{err});
    87	        };
    88	    }
    89	
    90	    block.renderer.frameCompleted(health);
    91	}
    92	
    93	/// Add a render pass to this frame with the provided attachments.
    94	/// Returns a RenderPass which allows render steps to be added.
    95	pub inline fn renderPass(
    96	    self: *const Self,
    97	    attachments: []const RenderPass.Options.Attachment,
    98	) RenderPass {
    99	    return RenderPass.begin(.{
   100	        .attachments = attachments,
   101	        .command_buffer = self.buffer,
   102	    });
   103	}
   104	
   105	/// Complete this frame and present the target.
   106	///
   107	/// If `sync` is true, this will block until the frame is presented.
   108	pub inline fn complete(self: *Self, sync: bool) void {
   109	    // If we don't need to complete synchronously,
   110	    // we add our block as a completion handler.
   111	    //
   112	    // It will be copied when we add the handler, and then the
   113	    // copy will be deallocated by the objc runtime on success.
   114	    if (!sync) {
   115	        self.buffer.msgSend(
   116	            void,
   117	            objc.sel("addCompletedHandler:"),
   118	            .{&self.block},
   119	        );
   120	    }
   121	
   122	    self.buffer.msgSend(void, objc.sel("commit"), .{});
   123	
   124	    // If we need to complete synchronously, we wait until
   125	    // the buffer is completed and invoke the block directly.
   126	    if (sync) {
   127	        self.buffer.msgSend(void, "waitUntilCompleted", .{});
   128	        self.block.sync = true;
   129	        CompletionBlock.invoke(&self.block, .{self.buffer.value});
   130	    }
   131	}
