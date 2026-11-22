    13	pub const TextRun = struct {
    14	    /// A unique hash for this run. This can be used to cache the shaping
    15	    /// results. We don't provide a means to compare actual values if the
    16	    /// hash is the same, so we should continue to improve this hash to
    17	    /// lower the chance of hash collisions if they become a problem. If
    18	    /// there are hash collisions, it would result in rendering issues but
    19	    /// the core data would be correct.
    20	    ///
    21	    /// The hash is position-independent within the row by using relative
    22	    /// cluster positions. This allows identical runs in different positions
    23	    /// to share the same cache entry, improving cache efficiency.
    24	    hash: u64,
    25	
    26	    /// The offset in the row where this run started. This is added to the
    27	    /// X position of the final shaped cells to get the absolute position
    28	    /// in the row where they belong.
    29	    offset: u16,
    30	
    31	    /// The total number of cells produced by this run.
    32	    cells: u16,
    33	
    34	    /// The font grid that built this run.
    35	    grid: *font.SharedGrid,
    36	
    37	    /// The font index to use for the glyphs of this run.
    38	    font_index: font.Collection.Index,
    39	};
    40	
    41	/// RunIterator is an iterator that yields text runs.
    42	pub const RunIterator = struct {
    43	    hooks: font.Shaper.RunIteratorHook,
    44	    opts: shape.RunOptions,
    45	    i: usize = 0,
    46	
    47	    pub fn next(self: *RunIterator, alloc: Allocator) !?TextRun {
    48	        const slice = &self.opts.cells;
    49	        const cells: []const terminal.page.Cell = slice.items(.raw);
    50	        const graphemes: []const []const u21 = slice.items(.grapheme);
    51	        const styles: []const terminal.Style = slice.items(.style);
   270	            // Add all the codepoints for our grapheme
   271	            try self.addCodepoint(
   272	                &hasher,
   273	                if (cell.codepoint() == 0) ' ' else cell.codepoint(),
   274	                @intCast(cluster),
   275	            );
   276	            if (cell.hasGrapheme()) {
   277	                for (graphemes[j]) |cp| {
   278	                    // Do not send presentation modifiers
   279	                    if (cp == 0xFE0E or cp == 0xFE0F) continue;
   280	                    try self.addCodepoint(&hasher, cp, @intCast(cluster));
   281	                }
   282	            }
   283	        }
   284	
   285	        // Finalize our buffer
   286	        self.hooks.finalize();
   287	
   288	        // Add our length to the hash as an additional mechanism to avoid collisions
   289	        autoHash(&hasher, j - self.i);
   290	
   291	        // Add our font index
   292	        autoHash(&hasher, current_font);
   293	
   294	        // Move our cursor. Must defer since we use self.i below.
   295	        defer self.i = j;
   296	
   297	        return .{
   298	            .hash = hasher.final(),
   299	            .offset = @intCast(self.i),
   300	            .cells = @intCast(j - self.i),
   301	            .grid = self.opts.grid,
   302	            .font_index = current_font,
   303	        };
   304	    }
