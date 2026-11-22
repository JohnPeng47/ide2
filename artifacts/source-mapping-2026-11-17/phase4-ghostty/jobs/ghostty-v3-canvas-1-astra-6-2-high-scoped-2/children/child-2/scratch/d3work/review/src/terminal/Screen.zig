  1719	pub inline fn scroll(self: *Screen, behavior: Scroll) void {
  1720	    defer self.assertIntegrity();
  1721	
  1722	    if (comptime build_options.kitty_graphics) {
  1723	        // No matter what, scrolling marks our image state as dirty since
  1724	        // it could move placements. If there are no placements or no images
  1725	        // this is still a very cheap operation.
  1726	        self.kitty_images.markDirty();
  1727	    }
  1728	
  1729	    switch (behavior) {
  1730	        .active => self.pages.scroll(.{ .active = {} }),
