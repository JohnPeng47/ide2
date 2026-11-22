  1240	    pub fn animationTick(self: *ImageStorage, io: std.Io, now_ms: u64) ?u64 {
  1241	        // Nothing changed since the last tick found nothing to play,
  1242	        // so there is still nothing to play. See
  1243	        // animation_idle_generation.
  1244	        if (self.animation_idle_generation == self.generation) return null;
  1245	
  1246	        var min_delay: ?u64 = null;
  1247	
  1248	        var it = self.images.iterator();
  1249	        while (it.next()) |entry| {
  1305	            // The current frame is replaced once its gap has elapsed.
  1306	            // We advance at most one displayed frame per tick with no
  1307	            // catch-up, exactly like Kitty: if ticks lag behind the
  1308	            // gaps, the animation slows down rather than skipping.
  1309	            var next_at: u64 = shown_at +| anim.gapAt(anim.current_index);
  1310	            if (now_ms >= next_at) advance: {
  1311	                // Walk forward to the next displayable frame. This is
  1312	                // a loop only because gapless (gap=0) frames are never
  1313	                // displayed and are stepped over; the durationMs gate
  1314	                // above guarantees a displayable frame exists.
  1315	                const count: u32 = anim.frameCount();
  1316	                var idx = anim.current_index;
  1317	                while (true) {
  1318	                    const next = (idx + 1) % count;
  1319	                    if (next == 0) {
  1320	                        // Wrapping past the last frame back to the
  1321	                        // root. A loading-state (a=a s=2) animation
  1322	                        // refuses the wrap: it parks on the last frame
  1323	                        // awaiting more frames from the client.
  1324	                        if (anim.state == .loading) break :advance;
  1325	
  1326	                        // Each wrap completes a loop; a finite budget
  1327	                        // that just ran out parks on the last frame.
  1328	                        anim.current_loop += 1;
  1329	                        if (anim.max_loops > 0 and
  1330	                            anim.current_loop >= anim.max_loops) break :advance;
  1331	                    }
  1332	                    idx = next;
  1333	                    if (anim.gapAt(idx) != 0) break;
  1334	                }
  1335	
  1336	                // Show the chosen frame: restart its gap timer and
  1337	                // stamp a fresh generation so consumers (the renderer
  1338	                // texture cache, the C API) pick up the new pixels.
  1339	                anim.current_index = idx;
  1340	                anim.frame_shown_at_ms = now_ms;
  1341	                self.markImageContentChanged(io, img);
  1342	                next_at = now_ms +| anim.gapAt(idx);
  1343	            }
  1344	
  1345	            // Schedule the next tick. A parked animation left next_at
  1346	            // in the past and so never schedules one; it is woken by
  1347	            // its trigger instead (a new frame arriving, or an a=a
  1348	            // command changing the state).
  1349	            if (next_at > now_ms) {
  1350	                const delay = next_at - now_ms;
  1351	                min_delay = if (min_delay) |m| @min(m, delay) else delay;
  1352	            }
  1353	        }
  1354	
  1355	        // Remember the generation only when nothing is playing. We
  1356	        // read it after the loop because showing a new frame above
  1357	        // changes it. That case always schedules another tick, so it
  1358	        // never records a stale value here.
  1359	        self.animation_idle_generation = if (min_delay == null)
  1360	            self.generation
  1361	        else
  1362	            null;
  1363	
  1364	        return min_delay;
  1365	    }
