    41	/// Cache for codepoints to font indexes in a group.
    42	codepoints: std.HashMapUnmanaged(CodepointKey, ?Collection.Index, CodepointKey.Context, 80) = .{},
    43	
    44	/// Cache for glyph renders into the atlas.
    45	glyphs: std.HashMapUnmanaged(GlyphKey, Render, GlyphKey.Context, 80) = .{},
    46	
    47	/// The texture atlas to store renders in. The Glyph data in the glyphs
    48	/// cache is dependent on the atlas matching.
    49	atlas_grayscale: Atlas,
    50	atlas_color: Atlas,
    51	
    52	/// The underlying resolver for font data, fallbacks, etc. The shared
    53	/// grid takes ownership of the resolver and will free it.
    54	resolver: CodepointResolver,
    55	
    56	/// The currently active grid metrics dictating the layout of the grid.
    57	/// This is calculated based on the resolver and current fonts.
    58	metrics: Metrics,
    59	
    60	/// The RwLock used to protect the shared grid. Callers are expected to use
    61	/// this directly if they need to i.e. access the atlas directly. Because
    62	/// callers can use this lock directly, maintainers need to be extra careful
    63	/// to review call sites to ensure they are using the lock correctly.
    64	lock: std.Io.RwLock,
   379	pub fn renderGlyph(
   380	    self: *SharedGrid,
   381	    alloc: Allocator,
   382	    index: Collection.Index,
   383	    glyph_index: u32,
   384	    opts: RenderOptions,
   385	) RenderGlyphError!Render {
   386	    const tw = renderGlyph_tw;
   387	
   388	    const key = GlyphKey.from(.{ .index = index, .glyph = glyph_index, .opts = opts });
   389	
   390	    // Fast path: the cache has the value. This is almost always true and
   391	    // only requires a read lock.
   392	    {
   393	        self.lock.lockSharedUncancelable(global.io());
   394	        defer self.lock.unlockShared(global.io());
   395	        if (self.glyphs.get(key)) |v| return v;
   396	    }
   397	
   398	    // Slow path: we need to search this codepoint
   399	    self.lock.lockUncancelable(global.io());
   400	    defer self.lock.unlock(global.io());
   401	
   402	    const gop = try self.glyphs.getOrPut(alloc, key);
   403	    if (gop.found_existing) return gop.value_ptr.*;
   404	    errdefer self.glyphs.removeByPtr(gop.key_ptr);
   405	
   406	    // Get the presentation to determine what atlas to use
   407	    try tw.check(.get_presentation);
   408	    const p = try self.resolver.getPresentation(index, glyph_index);
   409	    const atlas: *font.Atlas = switch (p) {
   410	        .text => &self.atlas_grayscale,
   411	        .emoji => &self.atlas_color,
   412	    };
   413	
   414	    var render_opts = opts;
   415	
   416	    // Always use these constraints for emoji.
   417	    if (p == .emoji) {
   418	        render_opts.constraint = .{
   419	            // Scale emoji to be as large as possible
   420	            // while preserving their aspect ratio.
   421	            .size = .cover,
   422	
   423	            // Center the emoji in its cells.
   424	            .align_horizontal = .center,
   425	            .align_vertical = .center,
   426	
   427	            // Add a small bit of padding so the emoji
   428	            // doesn't quite touch the edges of the cells.
   429	            .pad_left = 0.025,
   430	            .pad_right = 0.025,
   431	        };
   432	    }
   433	
   434	    // Render into the atlas
   435	    const glyph = self.resolver.renderGlyph(
   436	        alloc,
   437	        atlas,
   438	        index,
   439	        glyph_index,
   440	        render_opts,
   441	    ) catch |err| switch (err) {
   442	        // If the atlas is full, we resize it
   443	        error.AtlasFull => blk: {
   444	            try atlas.grow(alloc, atlas.size * 2);
   445	            break :blk try self.resolver.renderGlyph(
   446	                alloc,
   447	                atlas,
   448	                index,
   449	                glyph_index,
   450	                render_opts,
   451	            );
   452	        },
   453	
   454	        else => return err,
   455	    };
   456	
   457	    // Cache and return
   458	    gop.value_ptr.* = .{
   459	        .glyph = glyph,
   460	        .presentation = p,
   461	    };
   462	
   463	    return gop.value_ptr.*;
   464	}
