import { validateBoxScene } from './box-scene.mjs';
import { COMPONENTS, makeDiagram } from './geometry.mjs';

export const DEFAULT_VIEW = Object.freeze({
  orientation: 'upright', azimuth: 35, tilt: 35, separation: 1000,
  opacity: 90, mode: 'all', scale: 1, panX: 0, panY: 0,
  selected: null, enabled: COMPONENTS.map(c => c.id),
});
export const STORAGE_KEY = 'projection-3d.visualizations.v1';
export const CURRENT_KEY = 'projection-3d.current.v1';

// Each file includes the source drawings, so it is independent of the live dataset.
export function createVisualization(name, sources, state, viewport, id = crypto.randomUUID()) {
  return validateVisualization({
    format: 'projection-3d', version: 1, id, name,
    diagrams: sources,
    view: Object.fromEntries(Object.keys(DEFAULT_VIEW).map(key =>
      [key, key === 'enabled' ? [...state.enabled] : state[key]])),
    viewport: { width: viewport.width, height: viewport.height },
  });
}

export function validateVisualization(value) {
  if(value?.version===2 && value?.kind==='node-boxes')return validateBoxScene(value);
  const fail = message => { throw new Error(`Invalid visualization: ${message}`); };
  if (!value || value.format !== 'projection-3d' || value.version !== 1) fail('unsupported format or version');
  if (typeof value.id !== 'string' || !value.id.trim() || value.id.length > 200) fail('missing ID');
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100) fail('name must be 1–100 characters');
  if (!Array.isArray(value.diagrams) || value.diagrams.length !== 2) fail('expected D2 and D5 drawings');
  value.diagrams.forEach((d, i) => {
    if (!d || d.id !== ['D2', 'D5'][i] || typeof d.name !== 'string' || typeof d.ascii !== 'string'
      || d.ascii.length > 500_000) fail('invalid drawing');
    makeDiagram(d, 8); // Validate correspondence anchors before replacing the scene.
  });
  const v = value.view;
  if (!v || !['upright', 'flat'].includes(v.orientation) || !['all', 'D2', 'D5'].includes(v.mode)) fail('invalid view');
  const limits = { azimuth: [-75, 75], tilt: v.orientation === 'flat' ? [-80, -10] : [-70, 70],
    separation: [100, 2000], opacity: [10, 100], scale: [.0001, 100], panX: [-1e7, 1e7], panY: [-1e7, 1e7] };
  for (const [key, [min, max]] of Object.entries(limits)) {
    if (!Number.isFinite(v[key]) || v[key] < min || v[key] > max) fail(`invalid ${key}`);
  }
  const ids = COMPONENTS.map(c => c.id);
  if (!Array.isArray(v.enabled) || v.enabled.some(id => !ids.includes(id))
    || new Set(v.enabled).size !== v.enabled.length) fail('invalid enabled components');
  if (v.selected !== null && (!ids.includes(v.selected) || !v.enabled.includes(v.selected))) fail('invalid selection');
  if (!value.viewport || ['width', 'height'].some(key => !Number.isFinite(value.viewport[key])
    || value.viewport[key] <= 0 || value.viewport[key] > 100_000)) fail('invalid viewport');
  return structuredClone(value);
}

export function restoreView(visualization, viewport) {
  const saved = validateVisualization(visualization);
  const ratio = Math.min(viewport.width / saved.viewport.width, viewport.height / saved.viewport.height);
  return { ...saved.view, scale: saved.view.scale * ratio, panX: saved.view.panX * ratio,
    panY: saved.view.panY * ratio, enabled: new Set(saved.view.enabled), hovered: null };
}
