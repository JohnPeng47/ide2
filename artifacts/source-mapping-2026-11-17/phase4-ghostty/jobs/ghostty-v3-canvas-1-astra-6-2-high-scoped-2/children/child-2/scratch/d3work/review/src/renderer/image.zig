    15	/// Generic image rendering state for the renderer. This stores all
    16	/// images and their placements and exposes only a limited public API
    17	/// for adding images and placements and drawing them.
    18	pub const State = struct {
    19	    /// The full image state for the renderer that specifies what images
    20	    /// need to be uploaded, pruned, etc.
    21	    images: ImageMap,
    22	
    23	    /// The placements for the Kitty image protocol, sorted by layer and
    24	    /// then by z-index.
    25	    kitty_placements: std.ArrayList(Placement),
    26	
    27	    /// Where the layers of `kitty_placements` end. Placements before
    28	    /// `kitty_bg_end` are drawn below the cell backgrounds. Placements
    29	    /// from `kitty_bg_end` up to `kitty_text_end` are drawn below the
    30	    /// text, and the rest are drawn above it.
    31	    kitty_bg_end: u32,
    32	    kitty_text_end: u32,
    33	
    34	    /// The render state's `imagePlacementsGeneration` when
    35	    /// `kitty_placements` was last built. Every Kitty placement comes
    36	    /// from the render state, so a different value means
    37	    /// `kitty_placements` is out of date.
    38	    kitty_placements_generation: u64,
    39	
    40	    /// The active screen's `ImageStorage.generation` when
    41	    /// `kitty_placements` was last built. Some changes to the images
    42	    /// don't change any placement but still need an update. For example,
    43	    /// deleting an image that has no placements leaves the placements as
    44	    /// they were, but its texture must be unloaded.
    45	    kitty_storage_generation: u64,
    46	
    47	    /// Overlays
    48	    overlay_placements: std.ArrayList(Placement),
    49	
    50	    pub const empty: State = .{
    51	        .images = .empty,
    52	        .kitty_placements = .empty,
    53	        .kitty_bg_end = 0,
    54	        .kitty_text_end = 0,
    55	        .kitty_placements_generation = 0,
    56	        .kitty_storage_generation = 0,
    57	        .overlay_placements = .empty,
    60	    pub fn deinit(self: *State, alloc: Allocator) void {
    61	        {
    62	            var it = self.images.iterator();
    63	            while (it.next()) |kv| kv.value_ptr.image.deinit(alloc);
    64	            self.images.deinit(alloc);
    65	        }
    66	        self.kitty_placements.deinit(alloc);
    67	        self.overlay_placements.deinit(alloc);
    68	    }
    76	    pub fn upload(
    77	        self: *State,
    78	        alloc: Allocator,
    79	        api: *GraphicsAPI,
    80	    ) bool {
    81	        var success: bool = true;
    82	        var image_it = self.images.iterator();
    83	        while (image_it.next()) |kv| {
    84	            const img = &kv.value_ptr.image;
    85	            if (img.isUnloading()) {
    86	                img.deinit(alloc);
    87	                self.images.removeByPtr(kv.key_ptr);
    88	                continue;
    89	            }
    90	
    91	            if (img.isPending()) {
    92	                img.upload(
    93	                    alloc,
    94	                    api,
    95	                ) catch |err| {
    96	                    log.warn("error uploading image to GPU err={}", .{err});
    97	                    success = false;
    98	                };
    99	            }
   100	        }
   101	
   102	        return success;
   103	    }
   104	
   105	    pub const DrawPlacements = enum {
   106	        kitty_below_bg,
   107	        kitty_below_text,
   108	        kitty_above_text,
   109	        overlay,
   110	    };
   111	
   112	    /// Draw the given named set of placements.
   113	    ///
   114	    /// Any placements that have non-uploaded images are ignored. Any
   115	    /// graphics API errors during drawing are also ignored.
   116	    pub fn draw(
   117	        self: *State,
   118	        api: *GraphicsAPI,
   119	        pipeline: GraphicsAPI.Pipeline,
   120	        pass: *GraphicsAPI.RenderPass,
   121	        placement_type: DrawPlacements,
   122	    ) void {
   123	        const placements: []const Placement = switch (placement_type) {
   124	            .kitty_below_bg => self.kitty_placements.items[0..self.kitty_bg_end],
   125	            .kitty_below_text => self.kitty_placements.items[self.kitty_bg_end..self.kitty_text_end],
   126	            .kitty_above_text => self.kitty_placements.items[self.kitty_text_end..],
   127	            .overlay => self.overlay_placements.items,
   128	        };
   129	
   130	        for (placements) |p| {
   131	            // Look up the image
   132	            const image = self.images.get(p.image_id) orelse {
   133	                log.warn("image not found for placement image_id={}", .{p.image_id});
   134	                continue;
   135	            };
   136	
   137	            // Get the texture
   138	            const texture = switch (image.image) {
   139	                .ready,
   140	                .unload_ready,
   141	                => |t| t,
   142	                else => {
   143	                    log.warn("image not ready for placement image_id={}", .{p.image_id});
   144	                    continue;
   145	                },
   146	            };
   147	
   148	            // Create our vertex buffer, which is always exactly one item.
   149	            // future(mitchellh): we can group rendering multiple instances of a single image
   150	            var buf = GraphicsAPI.Buffer(GraphicsAPI.shaders.Image).initFill(
   151	                api.imageBufferOptions(),
   152	                &.{.{
   153	                    .grid_pos = .{
   154	                        @as(f32, @floatFromInt(p.x)),
   155	                        @as(f32, @floatFromInt(p.y)),
   156	                    },
   157	
   158	                    .cell_offset = .{
   159	                        @as(f32, @floatFromInt(p.cell_offset_x)),
   160	                        @as(f32, @floatFromInt(p.cell_offset_y)),
   161	                    },
   162	
   163	                    .source_rect = .{
   164	                        @as(f32, @floatFromInt(p.source_x)),
   165	                        @as(f32, @floatFromInt(p.source_y)),
   166	                        @as(f32, @floatFromInt(p.source_width)),
   167	                        @as(f32, @floatFromInt(p.source_height)),
   168	                    },
   169	
   170	                    .dest_size = .{
   171	                        @as(f32, @floatFromInt(p.width)),
   172	                        @as(f32, @floatFromInt(p.height)),
   173	                    },
   174	                }},
   175	            ) catch |err| {
   176	                log.warn("error creating image vertex buffer err={}", .{err});
   177	                continue;
   178	            };
   179	            defer buf.deinit();
   180	
   181	            pass.step(.{
   182	                .pipeline = pipeline,
   183	                .buffers = &.{buf.buffer},
   184	                .textures = &.{texture},
   185	                .draw = .{
   186	                    .type = .triangle_strip,
   187	                    .vertex_count = 4,
   188	                },
   189	            });
   190	        }
   191	    }
   253	    pub fn kittyRequiresUpdate(
   254	        self: *const State,
   255	        t: *const terminal.Terminal,
   256	        render_state: *const terminal.RenderState,
   257	    ) bool {
   258	        // The placements changed.
   259	        if (render_state.imagePlacementsGeneration() != self.kitty_placements_generation) return true;
   260	
   261	        // The images changed. This catches changes that don't move any
   262	        // placement, such as deleting an image with no placements.
   263	        if (t.screens.active.kitty_images.generation != self.kitty_storage_generation) return true;
   264	
   265	        return false;
   266	    }
   267	
   268	    /// Rebuild the Kitty placements from the render state, and prepare
   269	    /// or unload the textures they need. `render_state` must have just
   270	    /// been updated from `t`. The terminal is only read to look up
   271	    /// images.
   272	    ///
   273	    /// This reads and writes state used by drawing.
   274	    pub fn kittyUpdate(
   275	        self: *State,
   276	        alloc: Allocator,
   277	        t: *const terminal.Terminal,
   278	        render_state: *const terminal.RenderState,
   279	    ) void {
   280	        const storage = &t.screens.active.kitty_images;
   281	
   282	        // Remember what we are building from, so that kittyRequiresUpdate
   283	        // can tell when it changes.
   284	        self.kitty_placements_generation = render_state.imagePlacementsGeneration();
   285	        self.kitty_storage_generation = storage.generation;
   286	
   287	        // We always clear our previous placements no matter what because
   288	        // we rebuild them from scratch.
   289	        self.kitty_placements.clearRetainingCapacity();
   290	
   291	        // Go through our known images and if there are any that are no longer
   292	        // in use then mark them to be freed.
   293	        //
   294	        // This never conflicts with the below because a placement can't
   295	        // reference an image that doesn't exist.
   296	        {
   297	            var it = self.images.iterator();
   298	            while (it.next()) |kv| {
   299	                switch (kv.key_ptr.*) {
   300	                    // We're only looking at Kitty images
   301	                    .kitty => |id| if (storage.imageById(id)) |image| {
   302	                        // An image whose displayed pixels are pending must
   303	                        // not keep an older texture for the same ID drawable
   304	                        // while its placements wait. For an animation, the
   305	                        // displayed pixels are the current frame's.
   306	                        if (image.renderData().isPending()) {
   307	                            kv.value_ptr.image.markForUnload();
   308	                        }
   309	                    } else {
   310	                        kv.value_ptr.image.markForUnload();
   311	                    },
   312	
   313	                    .overlay => {},
   314	                }
   315	            }
   316	        }
   317	
   318	        // The render state has already positioned every placement. It
   319	        // was updated under the same lock and only returns placements it
   320	        // can draw, so their images exist and are fully loaded.
   321	        var it = render_state.imagePlacementIterator();
   322	        while (it.next()) |p| {
   323	            const image = switch (p.protocol) {
   324	                .kitty => storage.imageById(p.image_id) orelse continue,
   325	            };
   326	
   327	            // For errors we log and continue. We try to place other
   328	            // placements even if one fails.
   329	            self.prepKittyImage(alloc, &image) catch |err| {
   330	                log.warn("error preparing kitty placement err={}", .{err});
   331	                continue;
   332	            };
   333	            self.kitty_placements.append(alloc, .{
   334	                .image_id = .{ .kitty = image.id },
   335	                .layer = p.layer,
   336	                .x = p.x,
   337	                .y = p.y,
   338	                .z = p.z,
   339	                .width = p.width,
   340	                .height = p.height,
   341	                .cell_offset_x = p.offset_x,
   342	                .cell_offset_y = p.offset_y,
   343	                .source_x = p.source_x,
   344	                .source_y = p.source_y,
   345	                .source_width = p.source_width,
   346	                .source_height = p.source_height,
   347	            }) catch |err| {
   348	                log.warn("error preparing kitty placement err={}", .{err});
   349	            };
   350	        }
   351	
   352	        // Sort the placements by layer, then by z-index. Placements with
   353	        // the same z-index are ordered by image, so that the order is
   354	        // stable from frame to frame.
   355	        std.mem.sortUnstable(
   356	            Placement,
   357	            self.kitty_placements.items,
   358	            {},
   359	            struct {
   360	                fn lessThan(
   361	                    ctx: void,
   362	                    lhs: Placement,
   363	                    rhs: Placement,
   364	                ) bool {
   365	                    _ = ctx;
   366	                    const lhs_layer = @backingInt(lhs.layer);
   367	                    const rhs_layer = @backingInt(rhs.layer);
   368	                    if (lhs_layer != rhs_layer) return lhs_layer < rhs_layer;
   369	                    return lhs.z < rhs.z or
   370	                        (lhs.z == rhs.z and lhs.image_id.zLessThan(rhs.image_id));
   371	                }
   372	            }.lessThan,
   373	        );
   374	
   375	        self.kitty_bg_end = layerEnd(self.kitty_placements.items, .below_background);
   376	        self.kitty_text_end = layerEnd(self.kitty_placements.items, .below_text);
   377	    }
   398	    fn prepImage(
   399	        self: *State,
   400	        alloc: Allocator,
   401	        id: Id,
   402	        generation: u64,
   403	        pending: Image.Pending,
   404	    ) PrepImageError!void {
   405	        // If this image exists and its generation is the same it is the
   406	        // identical image so we don't need to send it to the GPU.
   407	        const gop = try self.images.getOrPut(alloc, id);
   408	        if (gop.found_existing and
   409	            gop.value_ptr.generation == generation)
   410	        {
   411	            return;
   412	        }
   413	
   414	        // Store it in the map
   415	        const new_image: Image = if (pending.convertCopy(alloc)) |v| v else |_| {
   416	            if (!gop.found_existing) {
   417	                // If this is a new entry we can just remove it since it
   418	                // was never sent to the GPU.
   419	                _ = self.images.remove(id);
   420	            } else {
   421	                // If this was an existing entry, it is invalid and
   422	                // we must unload it.
   423	                gop.value_ptr.image.markForUnload();
   424	            }
   425	
   426	            return error.OutOfMemory;
   427	        };
   428	        // Note: we don't need to errdefer free the data because it is
   429	        // put into the map immediately below and our errdefer to
   430	        // handle our map state will fix this up.
   431	
   432	        if (!gop.found_existing) {
   433	            gop.value_ptr.* = .{
   434	                .image = new_image,
   435	                .generation = 0,
   436	            };
   437	        } else {
   438	            gop.value_ptr.image.markForReplace(
   439	                alloc,
   440	                new_image,
   441	            );
   442	        }
   443	
   444	        // If any error happens, we unload the image and it is invalid.
   445	        errdefer gop.value_ptr.image.markForUnload();
   446	
   447	        gop.value_ptr.image.getPendingPointer().?.prepForUpload(alloc) catch |err| {
   448	            log.warn("error preparing image for upload err={}", .{err});
   449	            return error.ImageConversionError;
   450	        };
   451	        gop.value_ptr.generation = generation;
   452	    }
   454	    /// Prepare the provided Kitty image for upload to the GPU by copying its
   455	    /// data with our allocator and setting it to the pending state.
   456	    fn prepKittyImage(
   457	        self: *State,
   458	        alloc: Allocator,
   459	        image: *const terminal.kitty.graphics.Image,
   460	    ) PrepImageError!void {
   461	        // For animated images this is the current animation frame;
   462	        // the image generation changes whenever the current frame
   463	        // does, so the upload cache stays coherent.
   464	        const data = image.renderData().bytes() orelse unreachable;
   465	        try self.prepImage(
   466	            alloc,
   467	            .{ .kitty = image.id },
   468	            image.generation,
   469	            .{
   470	                .width = image.width,
   471	                .height = image.height,
   472	                .pixel_format = switch (image.format) {
   473	                    .gray => .gray,
   474	                    .gray_alpha => .gray_alpha,
   475	                    .rgb => .rgb,
   476	                    .rgba => .rgba,
   477	                    .png => unreachable, // should be decoded by now
   478	                },
   479	
   480	                // constCasts are always gross but this one is safe is because
   481	                // the data is only read from here and copied into its own
   482	                // buffer.
   483	                .data = @constCast(data.ptr),
   484	            },
   485	        );
   486	    }
   666	        /// Converts the image data to a copy with a format that can be uploaded to the GPU.
   667	        /// If the data is already owned, use `convertReplace()` to be a no-op for data already
   668	        /// in a format that can be uploaded.
   669	        fn convertCopy(self: *const Image.Pending, alloc: Allocator) wuffs.Error!Image {
   670	            // As things stand, we currently convert all images to RGBA before
   671	            // uploading to the GPU. This just makes things easier. In the future
   672	            // we may want to support other formats.
   673	            const data = self.dataSlice();
   674	            const rgba = try switch (self.pixel_format) {
   675	                .gray => wuffs.swizzle.gToRgba(alloc, data),
   676	                .gray_alpha => wuffs.swizzle.gaToRgba(alloc, data),
   677	                .rgb => wuffs.swizzle.rgbToRgba(alloc, data),
   678	                .bgr => wuffs.swizzle.bgrToRgba(alloc, data),
   679	                .rgba => alloc.dupe(u8, data),
   680	                .bgra => wuffs.swizzle.bgraToRgba(alloc, data),
   681	            };
   682	            const result: Image = .{ .pending = .{
   683	                .height = self.height,
   684	                .width = self.width,
   685	                .pixel_format = .rgba,
   686	                .data = rgba.ptr,
   687	            } };
   688	            return result;
   689	        }
   778	    pub fn upload(
   779	        self: *Image,
   780	        alloc: Allocator,
   781	        api: *const GraphicsAPI,
   782	    ) (wuffs.Error || error{
   783	        /// Texture creation failed, usually a GPU memory issue.
   784	        UploadFailed,
   785	    })!void {
   786	        assert(self.isPending());
   787	
   788	        // Get our pending info
   789	        const p = self.getPendingPointer().?;
   790	
   791	        // No error recover is required after this call because it just
   792	        // converts in place and is idempotent.
   793	        try p.prepForUpload(alloc);
   794	
   795	        // Create our texture
   796	        const texture = Texture.init(
   797	            api.imageTextureOptions(.rgba, true),
   798	            @intCast(p.width),
   799	            @intCast(p.height),
   800	            p.dataSlice(),
   801	        ) catch return error.UploadFailed;
   802	        errdefer comptime unreachable;
   803	
   804	        // Uploaded. We can now clear our data and change our state.
   805	        //
   806	        // NOTE: For the `replace` state, this will free the old texture.
   807	        //       We don't currently actually replace the existing texture
   808	        //       in-place but that is an optimization we can do later.
   809	        self.deinit(alloc);
   810	        self.* = .{ .ready = texture };
   811	    }
