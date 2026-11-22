   124	pub fn step(self: *const Self, s: Step) void {
   212	    // Draw!
   213	    self.encoder.msgSend(
   214	        void,
   215	        objc.sel("drawPrimitives:vertexStart:vertexCount:instanceCount:"),
   216	        .{
   217	            @backingInt(s.draw.type),
   218	            @as(c_ulong, 0),
   219	            @as(c_ulong, s.draw.vertex_count),
   220	            @as(c_ulong, s.draw.instance_count),
   221	        },
   222	    );
   223	}
   224	
   225	/// Complete this render pass.
   226	/// This struct can no longer be used after calling this.
   227	pub fn complete(self: *const Self) void {
   228	    self.encoder.msgSend(void, objc.sel("endEncoding"), .{});
   229	}
