   282	/// ## Memory
   283	///
   284	/// Note: the render state retains as much memory as possible between updates
   285	/// to prevent future allocations. If a very large frame is rendered once,
   286	/// the render state will retain that much memory until deinit. To avoid
   287	/// waste, it is recommended that the caller `deinit` and start with an
   288	/// empty render state every so often.
   289	pub const RenderState = struct {
   290	    /// The current screen dimensions. It is possible that these don't match
   291	    /// the renderer's current dimensions in grid cells because resizing
   292	    /// can happen asynchronously. For example, for Metal, our NSView resizes
   293	    /// at a different time than when our internal terminal state resizes.
   294	    /// This can lead to a one or two frame mismatch a renderer needs to
   295	    /// handle.
   296	    ///
   297	    /// The viewport is always exactly equal to the active area size so this
   298	    /// is also the viewport size. It does not include overscan rows.
   299	    rows: size.CellCountInt,
   300	    cols: size.CellCountInt,
   301	
   302	    /// The color state for the terminal.
   303	    colors: Colors,
   304	
   305	    /// Cursor state within the viewport.
   306	    cursor: Cursor,
   307	
   308	    /// The captured rows, from top to bottom.
   309	    ///
   310	    /// Without overscan this has exactly `rows` entries and the index is
   311	    /// the viewport y. With overscan it has room for the requested rows
   312	    /// above and below the viewport, and the viewport starts at
   313	    /// `viewportStart()`. Only the entries in `rowDataRange()` hold data
   314	    /// from the last update. See "Overscan" in the `RenderState` docs.
   315	    ///
   316	    /// This is a MultiArrayList because only the update cares about
   317	    /// the allocators. Callers care about all the other properties, and
   318	    /// this better optimizes cache locality for read access for those
   319	    /// use cases.
   320	    row_data: std.MultiArrayList(Row),
   321	
   322	    /// The dirty state of the render state. This is set by the update method.
   323	    /// The renderer/caller should set this to false when it has handled
   324	    /// the dirty state.
   325	    dirty: Dirty,
   326	
   327	    /// The screen type that this state represents. This is used primarily
   328	    /// to detect changes.
   329	    screen: ScreenSet.Key,
   330	
   331	    /// The last viewport pin used to generate this state. This is NOT
   332	    /// a tracked pin and is generally NOT safe to read other than the direct
   333	    /// values for comparison.
   334	    viewport_pin: ?PageList.Pin = null,
   885	    pub fn deinit(self: *RenderState, alloc: Allocator) void {
   886	        for (
   887	            self.row_data.items(.arena),
   888	            self.row_data.items(.cells),
   889	            self.row_data.items(.applied_styles),
   890	        ) |state, *cells, *applied| {
   891	            var arena: ArenaAllocator = state.promote(alloc);
   892	            arena.deinit();
   893	            cells.deinit(alloc);
   894	            applied.deinit(alloc);
   895	        }
   896	        self.row_data.deinit(alloc);
   897	        self.pending_styles.deinit(alloc);
   898	        self.kitty.deinit(alloc);
   899	    }
   920	    /// Begin an update of the render state to the latest terminal
   921	    /// state. Every begin must be completed with an `endUpdate` call
   922	    /// before the render state is read.
   923	    ///
   924	    /// This two-phase structure exists for callers that lock the
   925	    /// terminal state: only this function requires terminal access, so
   926	    /// a caller can hold its lock for this call only and then call
   927	    /// `endUpdate` after releasing it. `endUpdate` exclusively reads
   928	    /// and writes memory owned by the render state.
   929	    ///
   930	    /// Work that doesn't require terminal access may be deferred to
   931	    /// `endUpdate` to keep this call (and therefore lock hold time) as
   932	    /// short as possible. At the time of writing, the deferred work is
   933	    /// the per-cell style denormalization, so between this call and
   934	    /// `endUpdate` the per-cell `style` data of any updated rows is
   935	    /// stale and must not be read. More work may be deferred in the
   936	    /// future; callers should treat the render state as incomplete
   937	    /// until `endUpdate` is called.
   938	    ///
   939	    /// This will reset the terminal dirty state since it is consumed
   940	    /// by this render state update.
   941	    pub fn beginUpdate(
   942	        self: *RenderState,
   943	        alloc: Allocator,
   944	        t: *Terminal,
   945	    ) Allocator.Error!void {
   946	        const s: *Screen = t.screens.active;
   947	        const viewport_pin = s.pages.getTopLeft(.viewport);
   948	
   949	        // The overscan rows to capture beyond the viewport. The request
   950	        // decides the layout of row_data, and the actual counts are
   951	        // limited to the rows that exist. With no request, everything
   952	        // below behaves exactly as it does without overscan.
   953	        const above_req: usize = self.overscan_request.above;
   954	        const below_req: usize = self.overscan_request.below;
   955	        const row_data_len: usize = above_req + s.pages.rows + below_req;
   956	
   957	        // The first captured row and how many rows above the viewport
   958	        // we actually got.
   959	        const top: struct { pin: PageList.Pin, above: usize } = if (above_req == 0)
   960	            .{ .pin = viewport_pin, .above = 0 }
   961	        else switch (viewport_pin.upOverflow(above_req)) {
   962	            .offset => |p| .{ .pin = p, .above = above_req },
   963	            .overflow => |o| .{ .pin = o.end, .above = above_req - o.remaining },
   964	        };
   965	
   966	        // How many rows below the viewport we actually get. The page list
   967	        // ends at the last active row, so this is zero whenever the
   968	        // viewport follows the active area. This is computed before the
   969	        // loop below so that a change can force a redraw. When new output
   970	        // appears below a scrolled viewport, it can land in an entry that
   971	        // was never built or that held a different row.
   972	        const below: usize = if (below_req == 0) 0 else below: {
   973	            const bottom = viewport_pin.down(s.pages.rows - 1).?;
   974	            break :below switch (bottom.downOverflow(below_req)) {
   975	                .offset => below_req,
   976	                .overflow => |o| below_req - o.remaining,
   977	            };
   978	        };
   979	
   980	        // The index of top.pin in row_data.
   981	        const first: usize = above_req - top.above;
   982	
   983	        const redraw = redraw: {
   984	            // If our screen key changed, we need to do a full rebuild
   985	            // because our render state is viewport-specific.
   986	            if (t.screens.active_key != self.screen) break :redraw true;
   987	
   988	            // If our terminal is dirty at all, we do a full rebuild. These
   989	            // dirty values are full-terminal dirty values.
   990	            {
   991	                const Int = @typeInfo(Terminal.Dirty).@"struct".backing_integer.?;
   992	                const v: Int = @bitCast(t.flags.dirty);
   993	                if (v > 0) break :redraw true;
   994	            }
   995	
   996	            // If our screen is dirty at all, we do a full rebuild. This is
   997	            // a full screen dirty tracker.
   998	            {
   999	                const Int = @typeInfo(Screen.Dirty).@"struct".backing_integer.?;
  1000	                const v: Int = @bitCast(t.screens.active.dirty);
  1001	                if (v > 0) break :redraw true;
  1002	            }
  1003	
  1004	            // If our dimensions changed, we do a full rebuild.
  1005	            if (self.rows != s.pages.rows or
  1006	                self.cols != s.pages.cols)
  1007	            {
  1008	                break :redraw true;
  1009	            }
  1010	
  1011	            // If our row_data layout changed (overscan request changed),
  1012	            // we do a full rebuild.
  1013	            if (self.row_data.len != row_data_len) break :redraw true;
  1014	
  1015	            // If the captured overscan changed, rows may have entered
  1016	            // row_data that were never built. This only happens when the
  1017	            // viewport is scrolled, so it's cheap to be safe.
  1018	            if (self.overscan.above != top.above or
  1019	                self.overscan.below != below) break :redraw true;
  1020	
  1021	            // If our viewport pin changed, we do a full rebuild.
  1022	            if (self.viewport_pin) |old| {
  1023	                if (!old.eql(viewport_pin)) break :redraw true;
  1024	            }
  1025	
  1026	            break :redraw false;
  1027	        };
  1028	
  1029	        // Always set our cheap fields, its more expensive to compare
  1030	        self.rows = s.pages.rows;
  1031	        self.cols = s.pages.cols;
  1032	        self.viewport_pin = viewport_pin;
  1033	        self.cursor.active = .{ .x = s.cursor.x, .y = s.cursor.y };
  1034	        self.cursor.cell = s.cursor.page_cell.*;
  1035	        self.cursor.style = s.cursor.style;
  1036	        self.cursor.visual_style = s.cursor.cursor_style;
  1037	        self.cursor.password_input = t.flags.password_input;
  1038	        self.cursor.visible = t.modes.get(.cursor_visible);
  1039	        self.cursor.blinking = t.modes.get(.cursor_blinking);
  1040	
  1041	        // Always reset the cursor viewport position. In the future we can
  1042	        // probably cache this by comparing the cursor pin and viewport pin
  1043	        // but may not be worth it.
  1044	        self.cursor.viewport = null;
  1045	
  1046	        // Colors.
  1047	        self.colors.cursor = t.colors.cursor.get();
  1048	
  1049	        // The palette is a relatively large copy (768 bytes at the time
  1050	        // of writing) so we only copy it when it could have changed. All
  1051	        // palette modifications set a terminal-level dirty flag (see
  1052	        // Terminal.Dirty.palette), and any terminal-level dirty flag
  1053	        // forces a redraw, so checking redraw is sufficient.
  1054	        if (redraw) self.colors.palette = t.colors.palette.current;
  1055	
  1056	        bg_fg: {
  1057	            // Background/foreground can be unset initially which would
  1058	            // depend on "default" background/foreground. The expected use
  1059	            // case of Terminal is that the caller set their own configured
  1060	            // defaults on load so this doesn't happen.
  1061	            const bg = t.colors.background.get() orelse break :bg_fg;
  1062	            const fg = t.colors.foreground.get() orelse break :bg_fg;
  1063	            if (t.modes.get(.reverse_colors)) {
  1064	                self.colors.background = fg;
  1065	                self.colors.foreground = bg;
  1066	            } else {
  1067	                self.colors.background = bg;
  1068	                self.colors.foreground = fg;
  1069	            }
  1070	        }
  1071	
  1072	        // Ensure our row length is exactly our height plus requested
  1073	        // overscan, freeing or allocating data as necessary. In
  1074	        // most cases we'll have a perfectly matching size.
  1075	        if (self.row_data.len != row_data_len) {
  1076	            @branchHint(.unlikely);
  1077	
  1078	            if (self.row_data.len < row_data_len) {
  1079	                // Resize our rows to the desired length, marking any added
  1080	                // values undefined.
  1081	                const old_len = self.row_data.len;
  1082	                try self.row_data.resize(alloc, row_data_len);
  1083	
  1084	                // Initialize all our values. Its faster to use slice() + set()
  1085	                // because appendAssumeCapacity does this multiple times.
  1086	                var row_data = self.row_data.slice();
  1087	                for (old_len..row_data_len) |y| {
  1088	                    row_data.set(y, .{
  1089	                        .arena = .{},
  1090	                        .pin = undefined,
  1091	                        .serial = undefined,
  1092	                        .raw = undefined,
  1093	                        .cells = .empty,
  1094	                        .dirty = true,
  1095	                        .selection = null,
  1096	                        .highlights = .empty,
  1097	                        .placeholders = .empty,
  1098	                        .applied_styles = .empty,
  1099	                    });
  1100	                }
  1101	            } else {
  1102	                const row_data = self.row_data.slice();
  1103	                for (
  1104	                    row_data.items(.arena)[row_data_len..],
  1105	                    row_data.items(.cells)[row_data_len..],
  1106	                    row_data.items(.applied_styles)[row_data_len..],
  1107	                ) |state, *cell, *applied| {
  1108	                    var arena: ArenaAllocator = state.promote(alloc);
  1109	                    arena.deinit();
  1110	                    cell.deinit(alloc);
  1111	                    applied.deinit(alloc);
  1112	                }
  1113	                self.row_data.shrinkRetainingCapacity(row_data_len);
  1114	            }
  1115	        }
  1116	
  1117	        // Break down our row data
  1118	        const row_data = self.row_data.slice();
  1119	        const row_arenas = row_data.items(.arena);
  1120	        const row_pins = row_data.items(.pin);
  1121	        const row_serials = row_data.items(.serial);
  1122	        const row_rows = row_data.items(.raw);
  1123	        const row_cells = row_data.items(.cells);
  1124	        const row_sels = row_data.items(.selection);
  1125	        const row_highlights = row_data.items(.highlights);
  1126	        const row_placeholders = row_data.items(.placeholders);
  1127	        const row_dirties = row_data.items(.dirty);
  1128	        const row_applied = row_data.items(.applied_styles);
  1129	
  1130	        // If we're redrawing then every row will be rebuilt, superseding
  1131	        // any pending style runs from prior updates. Clearing also
  1132	        // guarantees pending runs always match the current dimensions
  1133	        // (dimension changes force a redraw).
  1134	        if (redraw) self.pending_styles.clearRetainingCapacity();
  1135	
  1136	        // Go through and setup our rows. We iterate page chunks rather
  1137	        // than individual rows so that per-page work (dirty flags, cursor
  1138	        // detection, memory pointers) is hoisted out of the row loop. This
  1139	        // makes the common case of a clean (or mostly clean) frame very
  1140	        // cheap: a contiguous scan of row dirty flags.
  1141	        const builder: RowBuilder = .{
  1142	            .alloc = alloc,
  1143	            .cols = self.cols,
  1144	            .arenas = row_arenas,
  1145	            .raws = row_rows,
  1146	            .cells = row_cells,
  1147	            .sels = row_sels,
  1148	            .highlights = row_highlights,
  1149	            .placeholders = row_placeholders,
  1150	            .kitty_stale = &self.kitty.stale,
  1151	            .dirties = row_dirties,
  1152	            .pending_styles = &self.pending_styles,
  1153	            .applied_styles = row_applied,
  1154	        };
  1155	        const row_data_end: usize = first + top.above + self.rows + below;
  1156	        var y: usize = first;
  1157	        var any_dirty: bool = false;
  1158	        var page_it = top.pin.pageIterator(.right_down, null);
  1159	        while (y < row_data_end) {
  1160	            const chunk = page_it.next() orelse break;
  1161	            const node = chunk.node;
  1162	            const node_serial = node.serial;
  1163	            const p: *page.Page = node.page();
  1164	
  1165	            // The number of rows we consume from this chunk. The chunk
  1166	            // may extend beyond what we capture (the viewport is always
  1167	            // exactly `rows` tall, plus any overscan) so we clamp.
  1168	            const take: usize = @min(
  1169	                @as(usize, chunk.end - chunk.start),
  1170	                row_data_end - y,
  1171	            );
  1172	
  1173	            // Find our cursor if we haven't found it yet. We do this even
  1174	            // if rows are not dirty because the cursor is unrelated. We
  1175	            // can check the chunk bounds once rather than every row.
  1176	            if (self.cursor.viewport == null and
  1177	                node == s.cursor.page_pin.node)
  1178	            cursor: {
  1179	                const cy = s.cursor.page_pin.y;
  1180	                if (cy < chunk.start or cy >= chunk.start + take) break :cursor;
  1181	
  1182	                // The cursor may be in an overscan row, in which case it
  1183	                // is not visible in the viewport.
  1184	                const idx = y + (cy - chunk.start);
  1185	                const vp_start = self.viewportStart();
  1186	                if (idx < vp_start or idx >= vp_start + self.rows) break :cursor;
  1187	                self.cursor.viewport = .{
  1188	                    .y = @intCast(idx - vp_start),
  1189	                    .x = s.cursor.x,
  1190	
  1191	                    // Future: we should use our own state here to look this
  1192	                    // up rather than calling this.
  1193	                    .wide_tail = if (s.cursor.x > 0)
  1194	                        s.cursorCellLeft(1).wide == .wide
  1195	                    else
  1196	                        false,
  1197	                };
  1198	            }
  1199	
  1200	            // The page-level dirty flag applies to every row in the chunk.
  1201	            // We consume (clear) it now; each node appears at most once in
  1202	            // this iteration and we're the only consumer of dirty state.
  1203	            const page_dirty = p.dirty;
  1204	            if (page_dirty) p.dirty = false;
  1205	
  1206	            // Get our contiguous rows for this chunk.
  1207	            const page_rows: []page.Row = p.rows.ptr(p.memory)[chunk.start..][0..take];
  1208	            assert(p.size.cols == self.cols);
  1209	
  1210	            // Store our pins and their node generations. We have to store
  1211	            // these even for rows that aren't dirty because dirty is only a
  1212	            // renderer optimization; it doesn't apply to memory movement.
  1213	            // This lets us remap any cell pins back to an exact entry in our
  1214	            // RenderState and validate them later without dereferencing a
  1215	            // potentially stale node.
  1216	            //
  1217	            // We can skip the writes when the pins and serials are unchanged:
  1218	            // if we're not redrawing, every value was stored by a prior update
  1219	            // (row count changes force a redraw). Within a single update a
  1220	            // node appears at most once and its stored pins have consecutive
  1221	            // y values, so if the first and last entries of this chunk's range
  1222	            // already match then every entry in between matches too.
  1223	            if (redraw or
  1224	                row_pins[y].node != node or
  1225	                row_pins[y].y != chunk.start or
  1226	                row_serials[y] != node_serial or
  1227	                row_pins[y + take - 1].node != node or
  1228	                row_pins[y + take - 1].y != chunk.start + take - 1 or
  1229	                row_serials[y + take - 1] != node_serial)
  1230	            {
  1231	                for (
  1232	                    row_pins[y..][0..take],
  1233	                    row_serials[y..][0..take],
  1234	                    chunk.start..,
  1235	                ) |*pin, *serial, py| {
  1236	                    pin.* = .{ .node = node, .y = @intCast(py) };
  1237	                    serial.* = node_serial;
  1238	                }
  1239	            }
  1240	
  1241	            if (!redraw and !page_dirty) {
  1242	                // Only dirty rows (usually none) need a rebuild. Scan the
  1243	                // dirty flags a group at a time; the dirty bit is directly
  1244	                // testable on the packed row representation.
  1245	                var i: usize = 0;
  1246	                while (take - i >= RowDirtyMask.group_len) : (i += RowDirtyMask.group_len) {
  1247	                    if (RowDirtyMask.match(page_rows, i)) {
  1248	                        @branchHint(.likely);
  1249	                        continue;
  1250	                    }
  1251	
  1252	                    for (page_rows[i..][0..RowDirtyMask.group_len], i..) |*page_row, j| {
  1253	                        if (!page_row.dirty) continue;
  1254	                        any_dirty = true;
  1255	                        try builder.row(p, page_row, y + j);
  1256	                        page_row.dirty = false;
  1257	                    }
  1258	                }
  1259	                while (i < take) : (i += 1) {
  1260	                    const page_row = &page_rows[i];
  1261	                    if (!page_row.dirty) continue;
  1262	                    any_dirty = true;
  1263	                    try builder.row(p, page_row, y + i);
  1264	                    page_row.dirty = false;
  1265	                }
  1266	            } else {
  1267	                // Rebuild every row in the chunk.
  1268	                any_dirty = true;
  1269	                for (page_rows, 0..) |*page_row, i| {
  1270	                    builder.row(p, page_row, y + i) catch |err| {
  1271	                        // A failed row and every row not yet rebuilt must stay
  1272	                        // dirty so the next update cannot skip them and expose
  1273	                        // partially initialized managed cell data.
  1274	                        for (page_rows[i..]) |*remaining| remaining.dirty = true;
  1275	                        return err;
  1276	                    };
  1277	                    page_row.dirty = false;
  1278	                }
  1279	            }
  1280	
  1281	            y += take;
  1282	        }
  1283	        assert(y == row_data_end);
  1284	
  1285	        self.overscan = .{
  1286	            .above = @intCast(top.above),
  1287	            .below = @intCast(below),
  1288	        };
  1289	
  1290	        // Work out what the Kitty placeholder runs draw. This must come
  1291	        // after setting the overscan above, because it reads the
  1292	        // captured rows.
  1293	        if (comptime build_options.kitty_graphics) try Kitty.update(
  1294	            self,
  1295	            alloc,
  1296	            t,
  1297	            redraw,
  1298	            any_dirty,
  1299	        );
  1300	
  1301	        // If our screen has a selection, then mark the rows with the
  1302	        // selection. We do this outside of the loop above because its unlikely
  1303	        // a selection exists and because the way our selections are structured
  1304	        // today is very inefficient.
  1305	        //
  1306	        // NOTE: To improve the performance of the block below, we'll need
  1307	        // to rethink how we model selections in general.
  1308	        //
  1309	        // There are performance improvements that can be made here, though.
  1310	        // For example, `containedRow` recalculates a bunch of information
  1311	        // we can cache.
  1312	        if (s.selection) |*sel| selection: {
  1313	            @branchHint(.unlikely);
  1314	
  1315	            // Populate our selection cache to avoid some expensive
  1316	            // recalculation.
  1317	            const cache: *const SelectionCache = cache: {
  1318	                if (self.selection_cache) |*c| cache_check: {
  1319	                    // If we're redrawing, we recalculate the cache just to
  1320	                    // be safe.
  1321	                    if (redraw) break :cache_check;
  1322	
  1323	                    // If our selection isn't equal, we aren't cached!
  1324	                    if (!c.selection.eql(sel.*)) break :cache_check;
  1325	
  1326	                    // If we have no dirty rows, we can not recalculate.
  1327	                    if (!any_dirty) break :selection;
  1328	
  1329	                    // We have dirty rows, we can utilize the cache.
  1330	                    break :cache c;
  1331	                }
  1332	
  1333	                // Create a new cache
  1334	                const tl_pin = sel.topLeft(s);
  1335	                const br_pin = sel.bottomRight(s);
  1336	                self.selection_cache = .{
  1337	                    .selection = .init(tl_pin, br_pin, sel.rectangle),
  1338	                    .tl_pin = tl_pin,
  1339	                    .br_pin = br_pin,
  1340	                };
  1341	                break :cache &self.selection_cache.?;
  1342	            };
  1343	
  1344	            // Grab the inefficient data we need from the selection. At
  1345	            // least we can cache it.
  1346	            const tl = s.pages.pointFromPin(.screen, cache.tl_pin).?.screen;
  1347	
  1348	            // Not cached since the cell contents may change.
  1349	            const br_pin: PageList.Pin = if (!sel.rectangle and
  1350	                cache.br_pin.rowAndCell().cell.wide == .spacer_head)
  1351	                cache.br_pin.rightWrap(1) orelse cache.br_pin
  1352	            else
  1353	                cache.br_pin;
  1354	            const br = s.pages.pointFromPin(.screen, br_pin).?.screen;
  1355	
  1356	            // We need to determine if our selection is within the viewport.
  1357	            // The viewport is generally very small so the efficient way to
  1358	            // do this is to traverse the viewport pages and check for the
  1359	            // matching selection pages. Unused entries are skipped.
  1360	            const range = self.rowDataRange();
  1361	            for (
  1362	                row_pins[range.start..range.end],
  1363	                row_sels[range.start..range.end],
  1364	                row_dirties[range.start..range.end],
  1365	            ) |pin, *sel_bounds, *dirty| {
  1366	                const p = s.pages.pointFromPin(.screen, pin).?.screen;
  1367	                const row_sel = sel.containedRowCached(
  1368	                    s,
  1369	                    cache.tl_pin,
  1370	                    br_pin,
  1371	                    pin,
  1372	                    tl,
  1373	                    br,
  1374	                    p,
  1375	                ) orelse {
  1376	                    if (sel_bounds.* != null) {
  1377	                        sel_bounds.* = null;
  1378	                        dirty.* = true;
  1379	                        any_dirty = true;
  1380	                    }
  1381	                    continue;
  1382	                };
  1383	                const start = row_sel.start();
  1384	                const end = row_sel.end();
  1385	                assert(start.node == end.node);
  1386	                assert(start.x <= end.x);
  1387	                assert(start.y == end.y);
  1388	
  1389	                const start_x = if (start.x > 0 and
  1390	                    start.rowAndCell().cell.wide == .spacer_tail)
  1391	                    start.x - 1
  1392	                else
  1393	                    start.x;
  1394	
  1395	                sel_bounds.* = .{ start_x, end.x };
  1396	            }
  1397	        }
  1398	
  1399	        // Handle dirty state.
  1400	        if (redraw) {
  1401	            // Fully redraw resets some other state.
  1402	            self.screen = t.screens.active_key;
  1403	            self.dirty = .full;
  1404	
  1405	            // Note: we don't clear any row_data here because our rebuild
  1406	            // above did this.
  1407	        } else if (any_dirty and self.dirty == .false) {
  1408	            self.dirty = .partial;
  1409	        }
  1410	
  1411	        // Clear our dirty flags
  1412	        t.flags.dirty = .{};
  1413	        s.dirty = .{};
  1414	    }
  1416	    /// Complete a prior `beginUpdate` call by performing any deferred
  1417	    /// work. At the time of writing, this denormalizes the pending
  1418	    /// style runs into the per-cell style data.
  1419	    ///
  1420	    /// This only reads and writes memory owned by the render state, so
  1421	    /// it is safe to call while the terminal is being modified (no
  1422	    /// terminal lock is required).
  1423	    pub fn endUpdate(self: *RenderState) void {
  1424	        // Common case: no styled rows were rebuilt.
  1425	        if (self.pending_styles.items.len == 0) return;
  1426	
  1427	        const row_data = self.row_data.slice();
  1428	        const row_cells = row_data.items(.cells);
  1429	        const row_applied = row_data.items(.applied_styles);
  1430	
  1431	        // Process the pending runs one row segment at a time. All the
  1432	        // runs for a row are appended contiguously by a single
  1433	        // beginUpdate, so a segment boundary is simply a change in y.
  1434	        //
  1435	        // We consume the runs as a shrinking slice to reduce per-segment setup.
  1436	        var rest = self.pending_styles.items;
  1437	        while (rest.len > 0) {
  1438	            const y = rest[0].y;
  1439	            var n: usize = 1;
  1440	            while (n < rest.len and rest[n].y == y) n += 1;
  1441	            const segment = rest[0..n];
  1442	            rest = rest[n..];
  1443	
  1444	            // Defensive: the row data may have changed shape if the
  1445	            // caller violated ordering (e.g. an error path skipped an
  1446	            // endUpdate between updates). Any update that changes
  1447	            // dimensions clears the pending list (redraw), so this
  1448	            // should never actually trigger, but the cost is trivial.
  1449	            if (y >= row_cells.len) continue;
  1450	
  1451	            // If the segment matches the runs already denormalized
  1452	            // into this row's cell data then the per-cell styles are
  1453	            // already correct and the (comparatively large) fill can
  1454	            // be skipped entirely. This is the common case: rebuilt
  1455	            // rows usually keep their styling (only the text
  1456	            // changed), and full redraws of an unchanged screen keep
  1457	            // both.
  1458	            const applied = &row_applied[y];
  1459	            if (runsEql(applied.items, segment)) continue;
  1460	
  1461	            const cells = row_cells[y].slice();
  1462	            const styles = cells.items(.style);
  1463	            for (segment) |run| {
  1464	                // Clamp to cells.len rather than styles.len to avoid repeating
  1465	                // the capacity check from items(.style) for every run.
  1466	                const end = @min(run.end, cells.len);
  1467	                const start = @min(run.start, end);
  1468	
  1469	                fillStyles(styles[start..end], @bitCast(run.style));
  1470	            }
  1471	
  1472	            // Record what we applied so the next rebuild of this row
  1473	            // can skip the fill. beginUpdate reserved the capacity
  1474	            // (we cannot allocate here); if it doesn't fit (e.g.
  1475	            // segments merged across multiple begins without an end)
  1476	            // leave the cache empty, which never matches and simply
  1477	            // means the next rebuild applies its runs.
  1478	            applied.clearRetainingCapacity();
  1479	            if (applied.capacity >= segment.len) {
  1480	                applied.appendSliceAssumeCapacity(segment);
  1481	            }
  1482	        }
  1483	        self.pending_styles.clearRetainingCapacity();
  1484	    }
