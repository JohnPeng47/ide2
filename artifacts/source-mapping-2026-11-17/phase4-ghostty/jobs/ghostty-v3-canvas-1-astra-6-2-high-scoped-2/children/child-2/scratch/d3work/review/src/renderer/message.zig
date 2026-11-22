    29	    /// Change the font grid. This can happen for any number of reasons
    30	    /// including a font size change, family change, etc.
    31	    font_grid: struct {
    32	        grid: *font.SharedGrid,
    33	        set: *font.SharedGridSet,
    34	
    35	        // The key for the new grid. If adopting the new grid fails for any
    36	        // reason, the old grid should be kept but the new key should be
    37	        // dereferenced.
    38	        new_key: font.SharedGridSet.Key,
    39	
    40	        // After accepting the new grid, the old grid must be dereferenced
    41	        // using the fields below.
    42	        old_key: font.SharedGridSet.Key,
    43	    },
    45	    /// Changes the size. The screen size might change, padding, grid, etc.
    46	    resize: renderer.Size,
