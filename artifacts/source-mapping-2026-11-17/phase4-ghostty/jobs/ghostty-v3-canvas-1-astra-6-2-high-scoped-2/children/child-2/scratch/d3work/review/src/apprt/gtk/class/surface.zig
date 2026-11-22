   835	    pub fn redraw(self: *Self) void {
   836	        const priv = self.private();
   837	        priv.render_surface.as(gtk.Widget).queueDraw();
   838	    }
