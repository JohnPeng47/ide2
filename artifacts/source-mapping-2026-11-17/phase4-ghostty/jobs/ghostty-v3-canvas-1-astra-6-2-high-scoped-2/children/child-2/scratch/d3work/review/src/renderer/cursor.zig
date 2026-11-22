    34	/// Returns the cursor style to use for the current render state or null
    35	/// if a cursor should not be rendered at all.
    36	pub fn style(
    37	    state: *const terminal.RenderState,
    38	    opts: StyleOptions,
    39	) ?Style {
    40	    // Note the order of conditionals below is important. It represents
    41	    // a priority system of how we determine what state overrides cursor
    42	    // visibility and style.
    43	
    44	    // The cursor must be visible in the viewport to be rendered.
    45	    if (state.cursor.viewport == null) return null;
    46	
    47	    // If we are in preedit, then we always show the block cursor. We do
    48	    // this even if the cursor is explicitly not visible because it shows
    49	    // an important editing state to the user.
    50	    if (opts.preedit) return .block;
    51	
    52	    // If we're at a password input its always a lock.
    53	    if (state.cursor.password_input) return .lock;
    54	
    55	    // If the cursor is explicitly not visible by terminal mode, we don't render.
    56	    if (!state.cursor.visible) return null;
    57	
    58	    // If we're not focused, our cursor is always visible so that
    59	    // we can show the hollow box.
    60	    if (!opts.focused) return .block_hollow;
    61	
    62	    // If the cursor is blinking and our blink state is not visible,
    63	    // then we don't show the cursor.
    64	    if (state.cursor.blinking and !opts.blink_visible) return null;
    65	
    66	    // Otherwise, we use whatever style the terminal wants.
    67	    return .fromTerminal(state.cursor.visual_style);
    68	}
