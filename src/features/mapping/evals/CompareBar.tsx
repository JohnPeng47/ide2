import { PromptComparisonLauncher } from './PromptComparisonLauncher';
import { useRef, useState } from 'react';
import type { ComparePageSession } from '../../../../domain/mapping/compare/comparePageSession';
import type { ComparisonRunSummary } from '../../../../domain/mapping/compare/comparisonGeneration';
import type { EvalRunSummary } from '../../../../domain/mapping/evals/evalRun';
import { createCompareSession, generateComparison } from './compareApi';
import { readGenerated } from './evalsApi';
import { errorMessage } from './evalsFormat';
import type { PickedOutput } from './EvalsTree';

const MAX_SIDE_BY_SIDE = 6, MAX_LLM = 10;
/** Compares outputs ticked in the tree, across runs if needed. */
export function CompareBar({ picked, runs, onClear, onSession, onComparisonStarted }: {
  picked: PickedOutput[]; runs: EvalRunSummary[]; onClear: () => void;
  onSession: (session: ComparePageSession) => void; onComparisonStarted: (run: ComparisonRunSummary) => void;
}) {
  const [experiment, setExperiment] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef<{ signature: string; requestId: string }>(undefined);
  const once = (signature: string) => {
    if (pending.current?.signature !== signature) pending.current = { signature, requestId: crypto.randomUUID() };
    return pending.current.requestId;
  };
  const sources = () => Promise.all(picked.map(async item => ({ documentId: item.canvasId, checkpointId: item.checkpointId ?? (await readGenerated(item.canvasId)).history.headId })));
  const title = (kind: string) => {
    const runIds = [...new Set(picked.map(item => item.runId))];
    const run = runIds.length === 1 ? runs.find(item => item.id === runIds[0]) : undefined;
    return `${run ? `${run.contextName}` : 'Outputs'} · ${kind}`.slice(0, 120);
  };
  const act = async (task: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await task(); pending.current = undefined; } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  };
  const sideBySide = () => act(async () => {
    const items = await sources(), body = { title: title('side by side'), pairs: items.flatMap((A, i) => items.slice(i + 1).map(B => ({ A, B }))) };
    onSession(await createCompareSession({ requestId: once(JSON.stringify(body)), ...body })); onClear();
  });
  const llm = () => act(async () => {
    const run = runs.find(item => item.id === picked[0].runId);
    const body = { title: title('LLM comparison'), sources: await sources(), model: run?.request.model ?? 'gpt-6-sol', effort: run?.request.effort ?? 'high' as const };
    onComparisonStarted(await generateComparison({ requestId: once(JSON.stringify(body)), ...body })); onClear();
  });
  return <div className="compare-bar" role="region" aria-label="Compare selected outputs">
    <strong>{picked.length} selected</strong>
    {picked.length < 2 && <span className="evals-muted">Tick another output to compare.</span>}
    {error && <span role="alert" className="evals-error-text">{error}</span>}
    <div className="evals-actions">
      <button type="button" disabled={busy || picked.length < 2 || picked.length > MAX_SIDE_BY_SIDE}
        title={picked.length > MAX_SIDE_BY_SIDE ? `Select at most ${MAX_SIDE_BY_SIDE}` : 'Every selected pair, side by side'} onClick={() => void sideBySide()}>Side by side</button>
      <button type="button" className="is-primary" disabled={busy || picked.length < 2 || picked.length > MAX_LLM}
        title="An LLM picks corresponding diagram slices" onClick={() => void llm()}>LLM comparison</button>
      <button type="button" disabled={busy || picked.length < 2 || picked.length > MAX_LLM} onClick={() => setExperiment(true)}>Judge prompt effect</button>
      <button type="button" onClick={onClear}>Clear</button>
    </div>
    {experiment && <PromptComparisonLauncher picked={picked} onClose={() => setExperiment(false)} onStarted={run => { onComparisonStarted(run); onClear(); }} />}
  </div>;
}
