    81	    pub fn shape(self: *Shaper, run: font.shape.TextRun) ![]font.shape.Cell {
    82	        // TODO: memory check that cell_buf can fit results
    83	
    84	        const codepoints = self.run_buf.items(.codepoint);
    85	        const clusters = self.run_buf.items(.cluster);
    86	        assert(codepoints.len == clusters.len);
    87	
    88	        switch (codepoints.len) {
    89	            // Special cases: if we have no codepoints (is this possible?)
    90	            // then our result is also an empty cell run.
    91	            0 => return self.cell_buf[0..0],
    92	
    93	            // If we have only 1 codepoint, then we assume that it is
    94	            // a single grapheme and just let it through. At this point,
    95	            // we can't have any more information to do anything else.
    96	            1 => {
    97	                self.cell_buf[0] = .{
    98	                    .x = @intCast(clusters[0]),
    99	                    .glyph_index = codepoints[0],
   100	                };
   101	
   102	                return self.cell_buf[0..1];
   103	            },
   183	
   184	                        break :cluster buf;
   185	                    };
   186	                    defer self.alloc.free(cluster);
   187	
   188	                    var face = try run.group.group.faceFromIndex(run.font_index);
   189	                    const index = try face.graphemeGlyphIndex(cluster);
   190	
   191	                    self.cell_buf[cur] = .{
   192	                        .x = @intCast(clusters[start]),
   193	                        .glyph_index = index,
   194	                    };
   195	                },
   196	            }
   197	
   198	            start = i;
   199	            cur += 1;
   200	        }
   201	
   202	        return self.cell_buf[0..cur];
   203	    }
