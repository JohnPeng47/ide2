   128	pub fn close(self: *DisplayLink) void {
   129	    assert(!self.closed);
   130	    self.closed = true;
   131	
   132	    if (self.link.isRunning()) self.link.stop() catch |err| {
   133	        log.warn("error stopping display link err={}", .{err});
   134	    };
   135	    self.link.release();
   136	
   137	    // If a sync is queued on the main thread it runs after we return
   138	    // and still needs this struct, so it frees it instead of us.
   139	    if (!self.sync_queued.load(.seq_cst)) self.destroy();
   140	}
