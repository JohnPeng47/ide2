export interface Collector {
  inputs: { type: string; created: number; received: number }[];
  longTasks: { start: number; duration: number }[];
  frames: number[];
  outcome: { dom: number; settled: number } | null;
  error: string | null;
  arm(predicate: string, eventType?: string): void;
  disarm(): void;
  recordFrames(enabled: boolean): void;
  flushTasks(): void;
}
declare global { interface Window { __perf: Collector } }

// Self-contained: Playwright serializes this function into the browser.
export function installCollector() {
  let actionFrame = 0, gestureFrame = 0;
  let armed = false, wantedEvent = 'click', actionStart = Infinity;
  const c: Collector = window.__perf = {
    inputs: [], longTasks: [], frames: [], outcome: null, error: null,
    arm(source, eventType = 'click') {
      c.inputs = []; c.longTasks = [];
      c.disarm();
      observer?.takeRecords(); // discard queued entries from the preceding action
      c.outcome = null; c.error = null;
      wantedEvent = eventType; armed = true; actionStart = performance.now();
      const predicate = new Function(`return (${source})`)() as () => unknown;
      let dom = 0, fingerprint = '', stableFrames = 0;
      const check = () => {
        try {
          // In particular, never satisfy the release predicate before pointerup.
          if (c.inputs.length) {
            const result = predicate();
            if (result) {
              const current = JSON.stringify(result);
              if (!dom) dom = performance.now();
              stableFrames = current === fingerprint ? stableFrames + 1 : 1;
              fingerprint = current;
              if (stableFrames >= 3) {
                c.outcome = { dom, settled: performance.now() };
                armed = false;
                return;
              }
            } else { stableFrames = 0; fingerprint = ''; }
          }
        } catch (error) { c.error = String(error); armed = false; return; }
        actionFrame = requestAnimationFrame(check);
      };
      actionFrame = requestAnimationFrame(check);
    },
    disarm() { armed = false; cancelAnimationFrame(actionFrame); },
    recordFrames(enabled) {
      cancelAnimationFrame(gestureFrame);
      if (!enabled) return;
      c.frames = []; c.longTasks = []; c.inputs = [];
      observer?.takeRecords(); actionStart = performance.now();
      const tick = (time: number) => { c.frames.push(time); gestureFrame = requestAnimationFrame(tick); };
      gestureFrame = requestAnimationFrame(tick);
    },
    flushTasks() { if (observer) collect(observer.takeRecords()); },
  };
  const collect = (entries: PerformanceEntry[]) => {
    c.longTasks.push(...entries.filter(e => e.startTime + e.duration >= actionStart)
      .map(e => ({ start: e.startTime, duration: e.duration })));
  };
  const observer = PerformanceObserver.supportedEntryTypes.includes('longtask')
    ? new PerformanceObserver(list => collect(list.getEntries())) : null;
  observer?.observe({ type: 'longtask' });
  for (const type of ['click', 'pointerup']) window.addEventListener(type, event => {
    if (armed && type === wantedEvent) c.inputs.push({ type, created: event.timeStamp, received: performance.now() });
  }, { capture: true });
}
