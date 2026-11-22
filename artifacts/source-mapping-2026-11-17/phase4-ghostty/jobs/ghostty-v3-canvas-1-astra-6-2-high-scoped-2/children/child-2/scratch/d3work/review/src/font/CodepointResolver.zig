   327	pub fn renderGlyph(
   328	    self: *CodepointResolver,
   329	    alloc: Allocator,
   330	    atlas: *Atlas,
   331	    index: Collection.Index,
   332	    glyph_index: u32,
   333	    opts: RenderOptions,
   334	) !Glyph {
   335	    // Special-case fonts are rendered directly.
   336	    if (index.special()) |sp| switch (sp) {
   337	        .sprite => return try self.sprite.?.renderGlyph(
   338	            alloc,
   339	            atlas,
   340	            glyph_index,
   341	            opts,
   342	        ),
   343	    };
   344	
   345	    const face = try self.collection.getFace(index);
   346	    const glyph = try face.renderGlyph(alloc, atlas, glyph_index, opts);
   347	    // log.warn("GLYPH={}", .{glyph});
   348	    return glyph;
   349	}
