   149	    fn snapshot(self: *Self, snap: *gtk.Snapshot) callconv(.c) void {
   150	        const priv = self.private();
   151	
   152	        // Take the latest present from the renderer's queue, if any, and
   153	        // build a texture from it. `take` closes any present that was
   154	        // still unconsumed in the queue, but not the texture we're
   155	        // currently displaying.
   156	        if (priv.core_surface) |core| {
   157	            if (core.renderer.takeFrame()) |frame| {
   158	                self.rebuildTexture(frame) catch |err| switch (err) {
   159	                    // GTK can't import our DMABUFs, e.g. due to an
   160	                    // incompatible format modifier on multi-GPU setups.
   161	                    // Report unhealthy presentation health so the
   162	                    // renderer presents via CPU readback instead.
   163	                    error.DmabufBuildFailed => {
   164	                        log.warn(
   165	                            "failed to import dmabuf, asking renderer for CPU presentation",
   166	                            .{},
   167	                        );
   168	                        core.reportPresentationHealth(.unhealthy);
   169	                    },
   170	
   171	                    else => log.warn("error building texture from frame err={}", .{err}),
   172	                };
   173	            }
   174	        }
   175	
   176	        // If we have a texture, draw it.
   177	        const texture = priv.texture orelse return;
   178	
   179	        const widget = self.as(gtk.Widget);
   180	        if (widget.getWidth() == 0 or widget.getHeight() == 0) return;
   181	
   182	        // Map one texture texel to one device pixel. Widget CSS size would
   183	        // stretch a fractionally scaled buffer. Snap the surface-relative
   184	        // origin so parent chrome cannot place the texture between pixels.
   185	        const layout = scale_util.widgetLayout(widget);
   186	        const origin = layout.snapOrigin();
   187	        const scale: f32 = @floatCast(layout.scale);
   188	        const css_w: f32 = @as(f32, @floatFromInt(texture.getWidth())) / scale;
   189	        const css_h: f32 = @as(f32, @floatFromInt(texture.getHeight())) / scale;
   190	
   191	        // GTK, Metal, Vulkan, etc. all have their origin points in the
   192	        // top left, but not OpenGL!
   193	        const flip = !rendererpkg.Renderer.custom_shader_y_is_down;
   194	        if (flip) snap.save();
   195	        defer if (flip) snap.restore();
   196	        if (flip) {
   197	            snap.translate(&.{ .f_x = 0, .f_y = css_h });
   198	            snap.scale(1, -1);
   199	        }
   200	
   201	        snap.appendTexture(texture, &.{
   202	            .f_origin = .{ .f_x = @floatCast(origin.x), .f_y = @floatCast(origin.y) },
   203	            .f_size = .{ .f_width = css_w, .f_height = css_h },
   204	        });
   205	    }
   307	    fn rebuildTexture(self: *Self, frame: ExportedFrame) !void {
   308	        switch (frame) {
   309	            .dmabuf => |dmabuf| try self.rebuildDmabufTexture(dmabuf),
   310	            .memory => |memory| try self.rebuildMemoryTexture(memory),
   311	        }
   312	    }
   313	
   314	    /// Build a `GdkDmabufTexture` from the present and set it as our
   315	    /// current texture, unrefing any previous texture.
   316	    fn rebuildDmabufTexture(self: *Self, frame: Dmabuf) !void {
   317	        const priv = self.private();
   318	        const widget = self.as(gtk.Widget);
   319	        const display = widget.getDisplay();
   320	
   321	        const builder = gdk.DmabufTextureBuilder.new();
   322	        defer builder.unref();
   323	
   324	        builder.setDisplay(display);
   325	        builder.setWidth(frame.width);
   326	        builder.setHeight(frame.height);
   327	        builder.setFourcc(frame.fourcc);
   328	        builder.setModifier(frame.modifier);
   329	        builder.setPremultiplied(@intFromBool(frame.premultiplied));
   330	        builder.setNPlanes(@intCast(frame.planes.count));
   331	
   332	        for (0..frame.planes.count) |i| {
   333	            builder.setFd(@intCast(i), frame.planes.fds[i]);
   334	            builder.setOffset(@intCast(i), @intCast(frame.planes.offsets[i]));
   335	            builder.setStride(@intCast(i), @intCast(frame.planes.strides[i]));
   336	        }
   337	
   338	        // Build the texture. We retain ownership over the DMABUF FDs
   339	        // until the asynchronous texture building process is complete,
   340	        // so we have to make a heap copy of them, send them to GTK,
   341	        // and then destroy them once successful.
   342	        const app = Application.default();
   343	        const alloc = app.allocator();
   344	
   345	        const planes = try alloc.create(Planes);
   346	        errdefer alloc.destroy(planes);
   347	
   348	        planes.* = frame.planes;
   349	        errdefer planes.deinit();
   350	
   351	        var err_: ?*glib.Error = null;
   352	        const texture = builder.build(
   353	            dmabufDestroy,
   354	            planes,
   355	            &err_,
   356	        ) orelse {
   357	            if (err_) |err|
   358	                log.warn("failed to build dmabuf err={s}", .{err.f_message orelse "(unknown)"});
   359	            return error.DmabufBuildFailed;
   360	        };
   361	
   362	        // Swap out the old texture.
   363	        if (priv.texture) |old| old.as(gobject.Object).unref();
   364	        priv.texture = texture;
   365	    }
   390	    fn rebuildMemoryTexture(self: *Self, frame: ExportedFrame.Memory) !void {
   391	        const priv = self.private();
   392	
   393	        const app = Application.default();
   394	        const alloc = app.allocator();
   395	
   396	        const holder = alloc.create(MemoryHolder) catch |err| {
   397	            // We own the pixels; make sure they don't leak.
   398	            frame.deinit();
   399	            return err;
   400	        };
   401	        errdefer alloc.destroy(holder);
   402	        holder.* = .{ .alloc = alloc, .pixels = frame.pixels };
   403	
   404	        // `GdkMemoryTexture` keeps a reference to the `GBytes` for as
   405	        // long as it needs the pixel data, so we hand it our holder and
   406	        // get the pixels freed via the destroy notify below.
   407	        const bytes = glib.Bytes.newWithFreeFunc(
   408	            holder.pixels.ptr,
   409	            holder.pixels.len,
   410	            &memoryDestroy,
   411	            holder,
   412	        );
   413	        errdefer bytes.unref();
   414	
   415	        const texture = gdk.MemoryTexture.new(
   416	            @intCast(frame.width),
   417	            @intCast(frame.height),
   418	            .r8g8b8a8_premultiplied,
   419	            bytes,
   420	            frame.width * 4, // stride
   421	        );
   422	
   423	        // The texture holds its own reference to the bytes now.
   424	        bytes.unref();
   425	
   426	        // Swap out the old texture.
   427	        if (priv.texture) |old| old.as(gobject.Object).unref();
   428	        priv.texture = texture.as(gdk.Texture);
   429	    }
   451	            gtk.Widget.virtual_methods.snapshot.implement(class, &snapshot);
