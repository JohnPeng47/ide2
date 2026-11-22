   692	    pub fn performAction(
   693	        self: *Self,
   694	        target: apprt.Target,
   695	        comptime action: apprt.Action.Key,
   696	        value: apprt.Action.Value(action),
   697	    ) !bool {
   698	        switch (action) {
   699	            .close_tab => return Action.closeTab(target, value),
   772	            .render => Action.render(target),
  2877	    pub fn render(target: apprt.Target) void {
  2878	        switch (target) {
  2879	            .app => {},
  2880	            .surface => |v| v.rt_surface.surface.redraw(),
  2881	        }
  2882	    }
