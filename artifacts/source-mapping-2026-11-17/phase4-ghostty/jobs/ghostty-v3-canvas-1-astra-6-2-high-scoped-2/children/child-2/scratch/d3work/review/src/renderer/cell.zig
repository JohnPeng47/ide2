    42	pub const Contents = struct {
    43	    size: renderer.GridSize = .{ .rows = 0, .columns = 0 },
    44	
    45	    /// Flat array containing cell background colors for the terminal grid.
    46	    ///
    47	    /// Indexed as `bg_cells[row * size.columns + col]`.
    48	    ///
    49	    /// Prefer accessing with `Contents.bgCell(row, col).*` instead
    50	    /// of directly indexing in order to avoid integer size bugs.
    51	    bg_cells: []shaderpkg.CellBg = &.{},
    52	
    53	    /// The lists which hold all of the foreground cells. When sized with
    54	    /// Contents.resize the individual ArrayLists are given enough room that
    55	    /// they can hold a single row with #cols glyphs, underlines, and
    56	    /// strikethroughs; however, appendAssumeCapacity MUST NOT be used since
    57	    /// it is possible to exceed this with combining glyphs that add a glyph
    58	    /// but take up no column since they combine with the previous one, as
    59	    /// well as with fonts that perform multi-substitutions for glyphs, which
    60	    /// can result in a similar situation where multiple glyphs reside in the
    61	    /// same column.
    62	    ///
    63	    /// Allocations should nevertheless be exceedingly rare since hitting the
    64	    /// initial capacity of a list would require a row filled with underlined
    65	    /// struck through characters, at least one of which is a multi-glyph
    66	    /// composite.
    67	    ///
    68	    /// Rows are indexed as Contents.fg_rows[y + 1], because the first list in
    69	    /// the collection is reserved for the cursor, which must be the first item
    70	    /// in the buffer.
    71	    ///
    72	    /// Must be initialized by calling resize on the Contents struct before
    73	    /// calling any operations.
    74	    fg_rows: []CellTextRow = &.{},
   130	    pub fn reset(self: *Contents) void {
   131	        @memset(self.bg_cells, .{ 0, 0, 0, 0 });
   132	        for (self.fg_rows) |*row| row.clearRetainingCapacity();
   133	    }
   134	
   135	    /// Set the cursor value. If the value is null then the cursor is hidden.
   136	    pub fn setCursor(
   137	        self: *Contents,
   138	        v: ?shaderpkg.CellText,
   139	        cursor_style: ?renderer.CursorStyle,
   140	    ) void {
   141	        if (self.size.rows == 0) return;
   142	        self.fg_rows[0].clearRetainingCapacity();
   143	        self.fg_rows[self.size.rows + 1].clearRetainingCapacity();
   144	
   145	        const cell = v orelse return;
   146	        const style = cursor_style orelse return;
   147	
   148	        switch (style) {
   149	            // Block cursors should be drawn first
   150	            .block => self.fg_rows[0].appendAssumeCapacity(cell),
   151	            // Other cursor styles should be drawn last
   152	            .block_hollow, .bar, .underline, .lock => self.fg_rows[self.size.rows + 1].appendAssumeCapacity(cell),
   153	        }
   154	    }
   181	    pub fn add(
   182	        self: *Contents,
   183	        alloc: Allocator,
   184	        comptime key: Key,
   185	        cell: key.CellType(),
   186	    ) Allocator.Error!void {
   187	        const y = cell.grid_pos[1];
   188	
   189	        assert(y < self.size.rows);
   190	
   191	        switch (key) {
   192	            .bg => comptime unreachable,
   193	
   194	            .text,
   195	            .underline,
   196	            .strikethrough,
   197	            .overline,
   198	            // We have a special list containing the cursor cell at the start
   199	            // of our fg row collection, so we need to add 1 to the y to get
   200	            // the correct index.
   201	            => try self.fg_rows[y + 1].append(alloc, cell),
   202	        }
   203	    }
