    13	/// The mutex that must be held while reading any of the data in the
    14	/// members of this state. Note that the state itself is NOT protected
    15	/// by the mutex and is NOT thread-safe, only the members values of the
    16	/// state (i.e. the terminal, devmode, etc. values).
    17	mutex: *std.Io.Mutex,
    18	
    19	/// The terminal data.
    20	terminal: *terminalpkg.Terminal,
    26	/// Dead key state. This will render the current dead key preedit text
    27	/// over the cursor. This currently only ever renders a single codepoint.
    28	/// Preedit can in theory be multiple codepoints long but that is left as
    29	/// a future exercise.
    30	preedit: ?Preedit = null,
    31	
    32	/// Mouse state. This only contains state relevant to what renderers
    33	/// need about the mouse.
    34	mouse: Mouse = .{},
    67	pub fn lockDemand(self: *State, io: std.Io) void {
    68	    _ = self.demand.fetchAdd(1, .monotonic);
    69	    self.mutex.lockUncancelable(io);
    70	    const prev = self.demand.fetchSub(1, .monotonic);
    71	    assert(prev > 0);
    72	}
    73	
    74	/// Release `mutex` acquired via `lockDemand` and notify hot loops
    75	/// parked in `yieldToDemand` that the demanding waiter had its turn.
    76	pub fn unlockDemand(self: *State, io: std.Io) void {
    77	    self.mutex.unlock(io);
    78	    _ = self.handoff_gen.fetchAdd(1, .monotonic);
    79	    io.futexWake(u32, &self.handoff_gen.raw, 1);
    80	}
   135	    /// Allocate a copy of this preedit in the given allocator..
   136	    pub fn clone(self: *const Preedit, alloc: Allocator) !Preedit {
   137	        return .{
   138	            .codepoints = try alloc.dupe(Codepoint, self.codepoints),
   139	        };
   140	    }
