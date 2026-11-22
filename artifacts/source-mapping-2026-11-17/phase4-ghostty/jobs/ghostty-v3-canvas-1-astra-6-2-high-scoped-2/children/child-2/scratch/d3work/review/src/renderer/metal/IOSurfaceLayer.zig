    50	/// Sets the layer's `contents` to the provided IOSurface.
    51	///
    52	/// Makes sure to do so on the main thread to avoid visual artifacts.
    53	pub inline fn setSurface(self: *IOSurfaceLayer, surface: *IOSurface) !void {
    54	    // We retain the surface to make sure it's not GC'd
    55	    // before we can set it as the contents of the layer.
    56	    //
    57	    // We release in the callback after setting the contents.
    58	    surface.retain();
    59	    // NOTE: Since `self.layer` is passed as an `objc.c.id`, it's
    60	    //       automatically retained when the block is copied, so we
    61	    //       don't need to retain it ourselves like with the surface.
    62	
    63	    var block = SetSurfaceBlock.init(.{
    64	        .layer = self.layer.value,
    65	        .surface = surface,
    66	    }, &setSurfaceCallback);
    67	
    68	    // We check if we're on the main thread and run the block directly if so.
    69	    const NSThread = objc.getClass("NSThread").?;
    70	    if (NSThread.msgSend(bool, "isMainThread", .{})) {
    71	        setSurfaceCallback(&block);
    72	    } else {
    73	        // NOTE: The block will be copied when we pass it to dispatch_async,
    74	        //       and then automatically be deallocated by the objc runtime
    75	        //       once it's executed.
    76	
    77	        macos.dispatch.dispatch_async(
    78	            @ptrCast(macos.dispatch.queue.getMain()),
    79	            @ptrCast(&block),
    80	        );
    81	    }
    82	}
    83	
    84	/// Sets the layer's `contents` to the provided IOSurface.
    85	///
    86	/// Does not ensure this happens on the main thread.
    87	pub inline fn setSurfaceSync(self: *IOSurfaceLayer, surface: *IOSurface) void {
    88	    self.layer.setProperty("contents", surface);
    89	}
    96	fn setSurfaceCallback(
    97	    block: *const SetSurfaceBlock.Context,
    98	) callconv(.c) void {
    99	    const layer = objc.Object.fromId(block.layer);
   100	    const surface: *IOSurface = block.surface;
   101	
   102	    // See explanation of why we retain and release in `setSurface`.
   103	    defer surface.release();
   104	
   105	    // We check to see if the surface is the appropriate size for
   106	    // the layer, if it's not then we discard it. This is because
   107	    // asynchronously drawn frames can sometimes finish just after
   108	    // a synchronously drawn frame during a resize, and if we don't
   109	    // discard the improperly sized surface it creates jank.
   110	    const bounds = layer.getProperty(macos.graphics.Rect, "bounds");
   111	    const scale = layer.getProperty(f64, "contentsScale");
   112	    const width: usize = @intFromFloat(bounds.size.width * scale);
   113	    const height: usize = @intFromFloat(bounds.size.height * scale);
   114	    if (width != surface.getWidth() or height != surface.getHeight()) {
   115	        log.debug(
   116	            "setSurfaceCallback(): surface is wrong size for layer, discarding. surface = {d}x{d}, layer = {d}x{d}",
   117	            .{ surface.getWidth(), surface.getHeight(), width, height },
   118	        );
   119	        return;
   120	    }
   121	
   122	    layer.setProperty("contents", surface);
   123	}
