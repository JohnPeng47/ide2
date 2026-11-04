import { createPortal } from 'react-dom';
import { useRef, useState } from 'react';
import type { CompareSource } from '../../../../domain/mapping/compare/comparePageSession';
import type { ComparisonRunSummary } from '../../../../domain/mapping/compare/comparisonGeneration';
import type { PickedOutput } from './EvalsTree';
import { Drawer } from './Drawer';
import { readGenerated } from './evalsApi';
import { generateComparison } from './compareApi';
import { errorMessage } from './evalsFormat';

export function PromptComparisonLauncher({ picked, onClose, onStarted }: {
  picked: PickedOutput[]; onClose: () => void; onStarted: (run: ComparisonRunSummary) => void;
}) {
  const [groups, setGroups] = useState(picked.map((_, index) => index === 0 ? 'baseline' : 'prompted'));
  const [difference, setDifference] = useState(''), [settings, setSettings] = useState('');
  const [model, setModel] = useState('gpt-6-sol'), [maximum, setMaximum] = useState(6);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef<{ signature: string; id: string }>(undefined);
  const baseline = groups.filter(group => group === 'baseline').length, prompted = groups.length - baseline;
  const start = async () => {
    setBusy(true); setError('');
    try {
      const sources: CompareSource[] = await Promise.all(picked.map(async item => ({ documentId: item.canvasId,
        checkpointId: item.checkpointId ?? (await readGenerated(item.canvasId)).history.headId })));
      const body = { title: 'Prompt effect judgement', sources, model, effort: 'high' as const, experiment: {
        baseline: sources.filter((_, i) => groups[i] === 'baseline'), prompted: sources.filter((_, i) => groups[i] === 'prompted'),
        promptDifference: difference, controlledSettings: settings, maxComparisons: maximum
      } };
      const signature = JSON.stringify(body);
      if (pending.current?.signature !== signature) pending.current = { signature, id: crypto.randomUUID() };
      onStarted(await generateComparison({ requestId: pending.current.id, ...body })); onClose();
    } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  };
  return createPortal(<Drawer title="Judge prompt effect" onClose={onClose} wide>
    <p>Assign groups explicitly. The Judge reads pinned canvases and produces a two-page report.</p>
    {picked.map((item, index) => <label className="evals-field" key={item.canvasId}>{item.label}
      <select aria-label={`Group for ${item.label}`} value={groups[index]} onChange={event => setGroups(groups.map((value, i) => i === index ? (event.target.value === 'baseline' ? 'baseline' : 'prompted') : value))}>
        <option value="baseline">Baseline</option><option value="prompted">Prompted</option>
      </select></label>)}
    <p>{baseline} baseline · {prompted} prompted. {(baseline === 1 || prompted === 1) && 'Single-output groups cannot establish recurrence or within-group variability.'}</p>
    <label className="evals-field">Exact prompt difference<textarea rows={10} value={difference} onChange={event => setDifference(event.target.value)} /></label>
    <label className="evals-field">Controlled generation settings<textarea rows={4} placeholder="Source context, template, model and settings held identical" value={settings} onChange={event => setSettings(event.target.value)} /></label>
    <label className="evals-field">Judge model<input value={model} onChange={event => setModel(event.target.value)} /></label>
    <label className="evals-field">Maximum comparisons<input type="number" min={0} max={40} value={maximum} onChange={event => setMaximum(Number(event.target.value))} /></label>
    {error && <p role="alert">{error}</p>}
    <button type="button" disabled={busy || !baseline || !prompted || !difference.trim() || !settings.trim() || !model.trim()} onClick={() => void start()}>Start Judge</button>
  </Drawer>, document.body);
}
