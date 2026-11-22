  3521	/// Scroll the viewport of the terminal grid.
  3522	pub fn scrollViewport(self: *Terminal, behavior: ScrollViewport) void {
  3523	    self.screens.active.scroll(switch (behavior) {
  3524	        .top => .{ .top = {} },
  3525	        .bottom => .{ .active = {} },
  3526	        .delta => |delta| .{ .delta_row = delta },
  3527	        .row => |row| .{ .row = row },
  3528	        .delta_prompt => |delta| .{ .delta_prompt = delta },
  3529	    });
  3530	}
