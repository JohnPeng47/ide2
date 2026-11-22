   114	    /// This queues a render operation with the renderer thread. The render
   115	    /// isn't guaranteed to happen immediately but it will happen as soon as
   116	    /// practical.
   117	    pub inline fn queueRender(self: *StreamHandler) !void {
   118	        try self.renderer_wakeup.notify();
   119	    }
