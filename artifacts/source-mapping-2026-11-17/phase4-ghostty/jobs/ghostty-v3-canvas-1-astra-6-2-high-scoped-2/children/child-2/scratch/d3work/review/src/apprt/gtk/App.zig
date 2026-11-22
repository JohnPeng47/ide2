    61	pub fn performAction(
    62	    self: *App,
    63	    target: apprt.Target,
    64	    comptime action: apprt.Action.Key,
    65	    value: apprt.Action.Value(action),
    66	) !bool {
    67	    return try self.app.performAction(target, action, value);
    68	}
