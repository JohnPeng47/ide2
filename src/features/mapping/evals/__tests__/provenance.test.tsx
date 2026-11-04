import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
// These tests render the launcher/diff only, never the canvas renderer.
vi.mock('../CompareCanvasPane', () => ({ CompareCanvasPane: () => null }));
vi.mock('../DiagramPane', () => ({ DiagramPane: () => null }));
import { RunLauncher } from '../RunLauncher';
import { PromptDiff } from '../ComparisonView';
import type { EvalRunSummary } from '../../../../../domain/mapping/evals/evalRun';
import type { EvalPrompt } from '../../../../../domain/mapping/evals/evalPrompt';
import type { CompareCanvasCopy } from '../../../../../domain/mapping/compare/comparePageSession';
import { layoutFromBounds } from '../../../../../domain/core/diagrams/layoutTemplate';

it('renders a rerun with pinned v2 text when the cached catalog only has v1, or the prompt is absent', () => {
  const prompt: EvalPrompt = { schemaVersion: 1, id: 'prompt', projectId: 'p', name: 'Example', workflow: 'alternatives', createdAt: '', updatedAt: '',
    versions: [{ version: 1, createdAt: '', stages: { alternative: 'Old text' } }] };
  const run = { id: 'run', projectId: 'p', workflow: 'alternatives', createdAt: '', inputs: {},
    prompts: [{ promptId: 'prompt', name: 'Example', version: 2, stages: { alternative: 'Pinned explicit instructions' } }],
    request: { prompts: [{ promptId: 'prompt', version: 2 }], inputs: {}, passes: 1, model: 'model', effort: 'high' } } as unknown as EvalRunSummary;
  for (const prompts of [[prompt], []]) {
    const html = renderToStaticMarkup(<RunLauncher prompts={prompts} runs={[run]} initial={{ workflow: 'alternatives', rerun: run }} onClose={() => {}} onStarted={() => {}} />);
    expect(html).toContain('v2'); expect(html).not.toContain('aria-label="Task"');
  }
});

it('diffs every workflow stage from immutable provenance without needing the prompt catalog', () => {
  const copy = (id: string, workflow: string, stages: Record<string, string>) => ({ generated: { workflow, prompt: { id, name: id, version: 1 }, promptStages: stages } }) as CompareCanvasCopy;
  const html = renderToStaticMarkup(<PromptDiff A={copy('roll', 'roll-up', { r2: 'Compress', g2: 'Attach' })}
    B={copy('alt', 'alternatives', { alternative: 'Entire alternative instruction' })} prompts={[]} onClose={() => {}} />);
  for (const text of ['Stage r2 diff', 'Stage g2 diff', 'Stage alternative diff', 'Entire alternative instruction']) expect(html).toContain(text);
});

it('shows pinned layout differences even when both user prompt versions are identical', () => {
  const A = { generated: { workflow: 'alternatives', prompt: { id: 'alt', name: 'Example', version: 1 }, promptStages: { alternative: 'Same instructions' } } } as unknown as CompareCanvasCopy;
  const B = structuredClone(A);
  B.generated!.layoutTemplate = { schemaVersion: 1, id: 'template', name: 'Deleted library template', projectId: 'p', createdAt: '',
    source: { documentId: 'deleted-source', checkpointId: 'pinned' }, geometry: layoutFromBounds([{ column: 5, row: 7, columns: 10, rows: 2 }]) };
  const html = renderToStaticMarkup(<PromptDiff A={A} B={B} prompts={[]} onClose={() => {}} />);
  expect(html).toContain('Pinned layout inputs');
  expect(html).toContain('No layout template.');
  expect(html).toContain('Deleted library template');
  expect(html).toContain('data-layout-slot="slot-1"');
});

it('loads every AgentContext page so contexts beyond the first hundred remain selectable', async () => {
  const { listContexts } = await import('../evalsApi');
  const fetcher = vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('offset=100')
    ? { items: [{ agentContextId: 'older-context', name: 'Older' }], nextOffset: null }
    : { items: Array.from({ length: 100 }, (_, i) => ({ agentContextId: `context-${i}`, name: 'Same name' })), nextOffset: 100 } }));
  vi.stubGlobal('fetch', fetcher);
  try { const result = await listContexts(); expect(result.items).toHaveLength(101); expect(result.items[100].agentContextId).toBe('older-context'); expect(fetcher).toHaveBeenCalledTimes(2); }
  finally { vi.unstubAllGlobals(); }
});
