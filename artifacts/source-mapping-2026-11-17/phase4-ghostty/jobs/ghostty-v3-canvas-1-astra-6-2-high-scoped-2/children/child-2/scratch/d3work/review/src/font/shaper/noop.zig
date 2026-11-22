    79	    pub fn shape(self: *Shaper, run: font.shape.TextRun) ![]const font.shape.Cell {
    80	        const state = &self.run_state;
    81	
    82	        // Special fonts aren't shaped and their codepoint == glyph so we
    83	        // can just return the codepoints as-is.
    84	        if (run.font_index.special() != null) {
    85	            self.cell_buf.clearRetainingCapacity();
    86	            try self.cell_buf.ensureTotalCapacity(self.alloc, state.codepoints.items.len);
    87	            for (state.codepoints.items) |entry| {
    88	                self.cell_buf.appendAssumeCapacity(.{
    89	                    .x = @intCast(entry.cluster),
    90	                    .glyph_index = @intCast(entry.codepoint),
    91	                });
    92	            }
    93	
    94	            return self.cell_buf.items;
    95	        }
    96	
    97	        // Go through the run and map each codepoint to a glyph index.
    98	        self.cell_buf.clearRetainingCapacity();
    99	
   100	        // Note: this is digging into some internal details, we should maybe
   101	        // expose a public API for this.
   102	        const face = try run.grid.resolver.collection.getFace(run.font_index);
   103	        for (state.codepoints.items) |entry| {
   104	            const glyph_index = face.glyphIndex(entry.codepoint) orelse {
   105	                // The run iterator shared logic should guarantee that
   106	                // there is a glyph index for all codepoints in the run.
   107	                // This is not well tested because we don't use the noop
   108	                // shaper in any release builds.
   109	                unreachable;
   110	            };
   111	            try self.cell_buf.append(self.alloc, .{
   112	                .x = @intCast(entry.cluster),
   113	                .glyph_index = glyph_index,
   114	            });
   115	        }
   116	
   117	        return self.cell_buf.items;
   118	    }
