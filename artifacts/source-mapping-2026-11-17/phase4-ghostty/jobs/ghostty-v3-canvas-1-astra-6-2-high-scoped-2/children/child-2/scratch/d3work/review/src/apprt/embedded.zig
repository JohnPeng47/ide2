  1001	    pub fn draw(self: *Surface) void {
  1002	        self.core_surface.draw() catch |err| {
  1003	            log.err("error in draw err={}", .{err});
  1004	            return;
  1005	        };
  1006	    }
  1988	    /// Tell the surface that it needs to schedule a render
  1989	    /// call as soon as possible (NOW if possible).
  1990	    export fn ghostty_surface_draw(surface: *Surface) void {
  1991	        surface.draw();
  1992	    }
