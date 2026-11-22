    94	/// The returned data (key and grid) should never be freed. The memory is
    95	/// owned by the set and will be freed when the ref count reaches zero.
    96	pub fn ref(
    97	    self: *SharedGridSet,
    98	    config: *const DerivedConfig,
    99	    font_size: DesiredSize,
   100	) !struct { Key, *SharedGrid } {
   101	    var key = try Key.init(self.alloc, config, font_size);
   102	    errdefer key.deinit();
   103	
   104	    self.lock.lockUncancelable(global.io());
   105	    defer self.lock.unlock(global.io());
   106	
   107	    const gop = try self.map.getOrPut(self.alloc, key);
   108	    if (gop.found_existing) {
   109	        log.debug("found cached grid for font config", .{});
   110	
   111	        // We can deinit the key because we found a cached value.
   112	        key.deinit();
   113	
   114	        // Increment our ref count and return the cache
   115	        gop.value_ptr.ref += 1;
   116	        return .{ gop.key_ptr.*, gop.value_ptr.grid };
   117	    }
   118	    errdefer self.map.removeByPtr(gop.key_ptr);
   119	
   120	    log.debug("initializing new grid for font config", .{});
   121	
   122	    // A new font config, initialize the cache.
   123	    const grid = try self.alloc.create(SharedGrid);
   124	    errdefer self.alloc.destroy(grid);
   125	    gop.value_ptr.* = .{
   126	        .grid = grid,
   127	        .ref = 1,
   128	    };
   129	
   130	    grid.* = try .init(self.alloc, resolver: {
   131	        // Build our collection. This is the expensive operation that
   132	        // involves finding fonts, loading them (maybe, some are deferred),
   133	        // etc.
   134	        var c = try self.collection(&key, font_size, config);
   135	        errdefer c.deinit(self.alloc);
   136	
   137	        // Setup our enabled/disabled styles
   138	        var styles = CodepointResolver.StyleStatus.initFill(true);
   139	        styles.set(.bold, config.@"font-style-bold" != .false);
   140	        styles.set(.italic, config.@"font-style-italic" != .false);
   141	        styles.set(.bold_italic, config.@"font-style-bold-italic" != .false);
   142	
   143	        // Init our resolver which just requires setting fields.
   144	        break :resolver .{
   145	            .collection = c,
   146	            .styles = styles,
   147	            .discover = try self.discover(),
   148	            .codepoint_map = key.codepoint_map,
   149	        };
   150	    });
   151	    errdefer grid.deinit(self.alloc);
   152	
   153	    return .{ gop.key_ptr.*, gop.value_ptr.grid };
   154	}
   411	/// Decrement the ref count for the given key. If the ref count is zero,
   412	/// the grid will be deinitialized and removed from the map.j:w
   413	pub fn deref(self: *SharedGridSet, key: Key) void {
   414	    self.lock.lockUncancelable(global.io());
   415	    defer self.lock.unlock(global.io());
   416	
   417	    const entry = self.map.getEntry(key) orelse return;
   418	    assert(entry.value_ptr.ref >= 1);
   419	
   420	    // If we have more than one reference, decrement and return.
   421	    if (entry.value_ptr.ref > 1) {
   422	        entry.value_ptr.ref -= 1;
   423	        return;
   424	    }
   425	
   426	    // We are at a zero ref count so deinit the group and remove.
   427	    entry.key_ptr.deinit();
   428	    entry.value_ptr.grid.deinit(self.alloc);
   429	    self.alloc.destroy(entry.value_ptr.grid);
   430	    self.map.removeByPtr(entry.key_ptr);
   431	}
