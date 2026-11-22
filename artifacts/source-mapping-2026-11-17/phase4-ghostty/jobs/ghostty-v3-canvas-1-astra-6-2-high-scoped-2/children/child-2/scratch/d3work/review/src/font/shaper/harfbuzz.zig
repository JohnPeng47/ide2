   131	    pub fn shape(self: *Shaper, run: font.shape.TextRun) ![]const font.shape.Cell {
   132	        // We only do shaping if the font is not a special-case. For special-case
   133	        // fonts, the codepoint == glyph_index so we don't need to run any shaping.
   134	        if (run.font_index.special() == null) {
   135	            // We have to lock the grid to get the face and unfortunately
   136	            // freetype faces (typically used with harfbuzz) are not thread
   137	            // safe so this has to be an exclusive lock.
   138	            run.grid.lock.lockUncancelable(global.io());
   139	            defer run.grid.lock.unlock(global.io());
   140	
   141	            const face = try run.grid.resolver.collection.getFace(run.font_index);
   142	            const i = if (!face.quirks_disable_default_font_features) 0 else i: {
   143	                // If we are disabling default font features we just offset
   144	                // our features by the hardcoded items because always
   145	                // add those at the beginning.
   146	                break :i default_features.len;
   147	            };
   148	
   149	            harfbuzz.shape(face.hb_font, self.hb_buf, self.hb_feats[i..]);
   150	        }
   151	
   152	        // If our buffer is empty, we short-circuit the rest of the work
   153	        // return nothing.
   154	        if (self.hb_buf.getLength() == 0) return self.cell_buf.items[0..0];
   229	            // Under both FreeType and CoreText the harfbuzz scale is
   230	            // in 26.6 fixed point units, so we round to the nearest
   231	            // whole value here.
   232	            const x_offset = run_offset.x - cell_offset.x + ((pos_v.x_offset + 0b100_000) >> 6);
   233	            const y_offset = run_offset.y + ((pos_v.y_offset + 0b100_000) >> 6);
   234	
   235	            // For debugging positions, turn this on:
   236	            //try self.debugPositions(run_offset, cell_offset, pos_v, index);
   237	
   238	            try self.cell_buf.append(self.alloc, .{
   239	                .x = @intCast(cell_offset.cluster),
   240	                .x_offset = @intCast(x_offset),
   241	                .y_offset = @intCast(y_offset),
   242	                .glyph_index = info_v.codepoint,
   243	            });
   244	
   245	            // Add our advances to keep track of our run offsets.
   246	            // Advances apply to the NEXT cell.
   247	            // Under both FreeType and CoreText the harfbuzz scale is
   248	            // in 26.6 fixed point units, so we round to the nearest
   249	            // whole value here.
   250	            run_offset.x += (pos_v.x_advance + 0b100_000) >> 6;
   251	            run_offset.y += (pos_v.y_advance + 0b100_000) >> 6;
   252	            run_offset.cluster = @max(run_offset.cluster, cluster);
   253	
   254	            // const i = self.cell_buf.items.len - 1;
   255	            // log.warn("i={} info={} pos={} cell={}", .{ i, info_v, pos_v, self.cell_buf.items[i] });
   256	        }
   257	        //log.warn("----------------", .{});
   258	
   259	        return self.cell_buf.items;
   260	    }
