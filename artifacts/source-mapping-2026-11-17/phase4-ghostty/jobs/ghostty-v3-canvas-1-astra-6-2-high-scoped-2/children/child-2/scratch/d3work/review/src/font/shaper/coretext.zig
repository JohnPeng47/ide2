   316	    pub fn shape(
   317	        self: *Shaper,
   318	        run: font.shape.TextRun,
   319	    ) ![]const font.shape.Cell {
   320	        const state = &self.run_state;
   356	        const attr_dict: *macos.foundation.Dictionary = try self.getFont(
   357	            run.grid,
   358	            run.font_index,
   359	        );
   360	
   361	        // Make room for the attributed string, CTTypesetter, and CTLine.
   362	        try self.cf_release_pool.ensureUnusedCapacity(self.alloc, 4);
   363	
   364	        const str = try macos.foundation.String.createWithCharactersNoCopy(state.unichars.items);
   365	        self.cf_release_pool.appendAssumeCapacity(str);
   366	
   367	        // Create an attributed string from our string
   368	        const attr_str = try macos.foundation.AttributedString.create(
   369	            str,
   370	            attr_dict,
   371	        );
   372	        self.cf_release_pool.appendAssumeCapacity(attr_str);
   373	
   374	        // Create a typesetter from the attributed string and the cached
   375	        // attr dict. (See comment in init for more info on the attr dict.)
   376	        const typesetter =
   377	            try macos.text.Typesetter.createWithAttributedStringAndOptions(
   378	                attr_str,
   379	                self.typesetter_attr_dict,
   380	            );
   381	        self.cf_release_pool.appendAssumeCapacity(typesetter);
   382	
   383	        // Create a line from the typesetter
   384	        const line = try typesetter.createLine(.{ .location = 0, .length = 0 });
   385	        self.cf_release_pool.appendAssumeCapacity(line);
   505	                const x_offset = position.x - cell_offset.x;
   506	
   507	                self.cell_buf.appendAssumeCapacity(.{
   508	                    .x = @intCast(cell_offset.cluster),
   509	                    .x_offset = @intFromFloat(@round(x_offset)),
   510	                    .y_offset = @intFromFloat(@round(position.y)),
   511	                    .glyph_index = glyph,
   512	                });
   513	
   514	                // Add our advances to keep track of our run offsets.
   515	                // Advances apply to the NEXT cell.
   516	                run_offset.x += advance.width;
   517	                run_offset.cluster = @max(run_offset.cluster, cluster);
   518	
   519	                // For debugging positions, turn this on:
   520	                //run_offset_y += advance.height;
   521	            }
   522	        }
   523	
   524	        // If our buffer contains some non-ltr sections we need to sort it :/
   525	        if (non_ltr) {
   526	            // This is EXCEPTIONALLY rare. Only happens for languages with
   527	            // complex shaping which we don't even really support properly
   528	            // right now, so are very unlikely to be used heavily by users
   529	            // of Ghostty.
   530	            @branchHint(.cold);
   531	            std.mem.sort(
   532	                font.shape.Cell,
   533	                self.cell_buf.items,
   534	                {},
   535	                struct {
   536	                    fn lt(_: void, a: font.shape.Cell, b: font.shape.Cell) bool {
   537	                        return a.x < b.x;
   538	                    }
   539	                }.lt,
   540	            );
   541	        }
   542	
   543	        return self.cell_buf.items;
   544	    }
