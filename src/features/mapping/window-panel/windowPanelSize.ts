type PanelSize = { width?: number; height?: number; minimizedWidth?: number };
type SizeUnit = 'pixels' | 'fraction';
const storageKey = (key: string) => `window-panel-size:${key}`;

/** Only explicit user resizes are saved; viewport clamping must not replace the preferred size. */
export function readWindowPanelSize(key: string | undefined, unit: SizeUnit): PanelSize | undefined {
  if (!key) return;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(key)) ?? 'null');
    if (!saved || saved.unit !== unit) return;
    const size: PanelSize = {};
    for (const field of ['width', 'height', 'minimizedWidth'] as const) {
      const value = saved[field];
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        size[field] = unit === 'fraction' ? Math.max(.2, Math.min(.95, value)) : value;
      }
    }
    return size;
  } catch { /* Storage can be unavailable or contain an older/invalid value. */ }
}

export function saveWindowPanelSize(key: string | undefined, unit: SizeUnit, size: PanelSize) {
  if (!key) return;
  try { localStorage.setItem(storageKey(key), JSON.stringify({ unit, ...size })); }
  catch { /* Resizing still works when browser storage is disabled or full. */ }
}
