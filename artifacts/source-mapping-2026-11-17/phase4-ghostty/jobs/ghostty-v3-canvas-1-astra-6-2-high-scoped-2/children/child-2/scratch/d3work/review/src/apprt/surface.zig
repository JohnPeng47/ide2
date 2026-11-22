   186	/// A surface mailbox.
   187	pub const Mailbox = struct {
   188	    surface: *Surface,
   189	    app: App.Mailbox,
   190	
   191	    /// Send a message to the surface.
   192	    pub fn push(
   193	        self: Mailbox,
   194	        msg: Message,
   195	        timeout: App.Mailbox.Queue.Timeout,
   196	    ) App.Mailbox.Queue.Size {
   197	        // Surface message sending is actually implemented on the app
   198	        // thread, so we have to rewrap the message with our surface
   199	        // pointer and send it to the app thread.
   200	        return self.app.push(.{
   201	            .surface_message = .{
   202	                .surface = self.surface,
   203	                .message = msg,
   204	            },
   205	        }, timeout);
   206	    }
   207	};
