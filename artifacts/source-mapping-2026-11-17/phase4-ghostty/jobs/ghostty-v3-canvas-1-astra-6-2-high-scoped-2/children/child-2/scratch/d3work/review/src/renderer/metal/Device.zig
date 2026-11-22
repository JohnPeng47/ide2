    34	pub fn init(alloc: std.mem.Allocator, options: Options) !*Device {
    35	    _ = options;
    36	    const self = try alloc.create(Device);
    37	    errdefer alloc.destroy(self);
    38	
    39	    // Choose our MTLDevice.
    40	    const device = try chooseDevice();
    41	    errdefer device.release();
    42	
    43	    // Grab metadata about the device.
    44	    const default_storage_mode: mtl.MTLResourceOptions.StorageMode = switch (comptime builtin.target.os.tag) {
    45	        // manage mode is not supported by iOS
    46	        .ios => .shared,
    47	        else => if (device.getProperty(bool, "hasUnifiedMemory")) .shared else .managed,
    48	    };
    49	    const max_texture_size = queryMaxTextureSize(device);
    50	    log.debug(
    51	        "device properties default_storage_mode={} max_texture_size={}",
    52	        .{ default_storage_mode, max_texture_size },
    53	    );
    54	
    55	    self.* = .{
    56	        .device = device,
    57	        .default_storage_mode = default_storage_mode,
    58	        .max_texture_size = max_texture_size,
    59	    };
    60	    return self;
    61	}
    62	
    63	pub fn deinit(self: *Device, alloc: std.mem.Allocator) void {
    64	    self.device.release();
    65	    alloc.destroy(self);
    66	}
