  3347	pub fn scroll(self: *PageList, behavior: Scroll) void {
  3348	    defer self.assertIntegrity();
  3349	
  3350	    // Special case no-scrollback mode to never allow scrolling.
  3351	    if (self.limits.bytes.explicit == 0) {
  3352	        self.viewport = .active;
  3353	        return;
  3354	    }
  3355	
  3356	    // Moving the viewport changes which historical pages are visible. Restart
  3357	    // traversal so pages which leave the viewport are reconsidered after the
  3358	    // renderer's idle delay. False positives from clamped scrolling are cheap.
  3359	    defer {
  3360	        self.page_compression.reset();
  3361	        self.page_compression.markActivity();
  3362	    }
  3363	
  3364	    switch (behavior) {
  3365	        .active => self.viewport = .active,
