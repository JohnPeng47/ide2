import { useEffect, useState, useSyncExternalStore } from 'react';
import { applyProjectionPositions, projectionGeometry, projectionPresets, type ProjectionSettings } from '../../../../domain/core/diagrams/highlightProjection';
import type { CanvasSession } from './canvasSession';
import { runWorkspaceTask } from './runWorkspaceTask';
import './projectionLayout.css';

/** A nonmodal tool window: the canvas remains interactive while settings are explored. */
export function ProjectionLayoutPanel({ session, disabled }: { session: CanvasSession; disabled: boolean }) {
  const controller = session.controller;
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const projection = snapshot.canvas.projectionLayout;
  const [settings, setSettings] = useState<ProjectionSettings>(projection?.settings ?? projectionPresets.Default);
  const [minimized, setMinimized] = useState(false);
  const [status, setStatus] = useState(''), [error, setError] = useState('');
  const savedKey = JSON.stringify(projection?.settings), settingsKey = JSON.stringify(settings);
  useEffect(() => { if (projection) setSettings(projection.settings); }, [savedKey]);
  useEffect(() => {
    if (disabled || !projection || settingsKey === savedKey) return;
    let cancelled = false;
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      const current = controller.getSnapshot(), baseline = current.canvas.projectionLayout;
      if (!baseline) return;
      setStatus('Arranging…'); setError('');
      try {
        const positions = await runWorkspaceTask({ type: 'projection-layout', geometry: projectionGeometry(current.document, baseline), projection: baseline, settings }, abort.signal);
        if (cancelled) return;
        controller.commitProjectionLayout(current.version, applyProjectionPositions(current.document, positions), { ...baseline, settings });
        setStatus('Layout updated');
      } catch (error) {
        if (!cancelled) { setError(error instanceof Error ? error.message : String(error)); setStatus(''); }
      }
    }, 140);
    return () => { cancelled = true; clearTimeout(timer); abort.abort(); };
  }, [controller, disabled, settingsKey, savedKey]);
  if (!projection) return null;
  const change = (patch: Partial<ProjectionSettings>) => setSettings(current => ({ ...current, ...patch }));
  const sliders = [
    ['attraction', 'Closeness to centroid'], ['neighbors', 'Closeness to neighbors'], ['fidelity', 'Original arrangement'], ['gap', 'Minimum gap']
  ] as const;
  return <aside className={`projection-layout-panel${minimized ? ' is-minimized' : ''}`} aria-label="Projection layout" data-diagram-canvas-static-ui
    onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') setMinimized(true); }}>
    <header><div><strong>Projection layout</strong>{!minimized && <small>{projection.nodes.length} diagrams · live layout</small>}</div>
      <button type="button" aria-label={minimized ? 'Expand layout settings' : 'Minimize layout settings'} onClick={() => setMinimized(value => !value)}>{minimized ? '+' : '−'}</button>
    </header>
    {!minimized && <>
      <fieldset disabled={disabled}>
        <legend className="projection-layout-label">Style</legend>
        <div className="projection-layout-presets">{Object.entries(projectionPresets).map(([name, preset]) =>
          <button type="button" key={name} aria-pressed={JSON.stringify(preset) === settingsKey} onClick={() => setSettings({ ...preset })}>{name}</button>)}</div>
        <label>Centroid<select aria-label="Layout centroid" disabled={settings.mode === 'original'} value={settings.centroid}
          onChange={event => change({ centroid: event.target.value as ProjectionSettings['centroid'], focusId: settings.focusId ?? projection.nodes[0].id })}>
          <option value="mean">Average center</option><option value="area">Area-weighted center</option><option value="diagram">A diagram</option>
          {projection.placeholderId && <option value="placeholder">Blank diagram</option>}
        </select></label>
        {settings.centroid === 'diagram' && <label>Center diagram<select aria-label="Center diagram" disabled={settings.mode === 'original'}
          value={settings.focusId ?? projection.nodes[0].id} onChange={event => change({ focusId: event.target.value })}>
          {projection.nodes.map((node, i) => <option key={node.id} value={node.id}>{i + 1}. {node.label}</option>)}
        </select></label>}
        {sliders.map(([key, label]) => <label className="projection-layout-slider" key={key}>
          <span>{label}<output>{key === 'gap' ? `${settings[key]} cells` : `${Math.round(settings[key] * 100)}%`}</output></span>
          <input aria-label={label} type="range" min="0" max={key === 'gap' ? 20 : 1} step={key === 'gap' ? 1 : .05} value={settings[key]}
            onChange={event => change({ [key]: Number(event.target.value), mode: 'compact' })} />
        </label>)}
      </fieldset>
      <p className="projection-layout-hint">{settings.mode === 'original' ? 'Original preserves source spacing; the blank diagram sits alongside.' : 'Keeps left/right and above/below order. Diagrams stay separate.'}</p>
      <p className="projection-layout-status" role="status">{status || 'Changes save automatically. Undo restores the previous layout.'}</p>
      {error && <p role="alert">{error}</p>}
    </>}
  </aside>;
}
