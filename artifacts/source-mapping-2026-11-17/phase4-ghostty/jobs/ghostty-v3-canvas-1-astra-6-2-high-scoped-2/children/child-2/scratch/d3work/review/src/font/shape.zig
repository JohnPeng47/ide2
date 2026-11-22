    19	/// Shaper implementation for our compile options.
    20	pub const Shaper = switch (options.backend) {
    21	    .freetype,
    22	    .freetype_windows,
    23	    .fontconfig_freetype,
    24	    .coretext_freetype,
    25	    .coretext_harfbuzz,
    26	    => harfbuzz.Shaper,
    27	
    28	    // Note that coretext_freetype cannot use the coretext
    29	    // shaper because the coretext shaper requests CoreText
    30	    // font faces.
    31	    .coretext => coretext.Shaper,
    32	
    33	    .coretext_noshape => noop.Shaper,
    34	
    35	    .web_canvas => web_canvas.Shaper,
    36	};
    37	
    38	/// A cell is a single glyph within a terminal that should be rendered
    39	/// for a shaping call. Not all terminal cells may be present; only
    40	/// cells that have a glyph that needs to be rendered.
    41	pub const Cell = struct {
    42	    /// The X position of this shaper cell relative to the offset of the
    43	    /// run. Because runs are always within a single row, it is expected
    44	    /// that the caller can reconstruct the full position of the cell by
    45	    /// using the known Y position of the cell and adding the X position
    46	    /// to the run offset.
    47	    x: u16,
    48	
    49	    /// An additional offset to apply to the rendering.
    50	    x_offset: i16 = 0,
    51	    y_offset: i16 = 0,
    52	
    53	    /// The glyph index for this cell. The font index to use alongside
    54	    /// this cell is available in the text run. This glyph index is only
    55	    /// valid for a given GroupCache and FontIndex that was used to create
    56	    /// the runs.
    57	    glyph_index: u32,
    58	};
    70	/// Options for runIterator.
    71	pub const RunOptions = struct {
    72	    /// The font state for the terminal screen. This is mutable because
    73	    /// cached values may be updated during shaping.
    74	    grid: *SharedGrid,
    75	
    76	    /// The cells for the row to shape.
    77	    cells: std.MultiArrayList(terminal.RenderState.Cell).Slice = .empty,
    78	
    79	    /// The x boundaries of the selection in this row.
    80	    selection: ?[2]u16 = null,
    81	
    82	    /// The cursor position within this row. This is used to break shaping
    83	    /// on cursor boundaries. This can be disabled by setting this to
    84	    /// null.
    85	    cursor_x: ?usize = null,
    86	
    87	    /// Apply the font break configuration to the run.
    88	    pub fn applyBreakConfig(
    89	        self: *RunOptions,
    90	        config: configpkg.FontShapingBreak,
    91	    ) void {
    92	        if (!config.cursor) self.cursor_x = null;
    93	    }
    94	};
