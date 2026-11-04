// node --import tsx scripts/evals/run-canvas-domain-refinement.ts [origin] [request UUID] [--prepare-only]
// Reuse the UUID after an uncertain transport response; all setup writes are idempotent.
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { canvasContext } from '../../domain/mapping/rollup/rollUp';
import type { CompareCandidate, CompareCanvasCopy } from '../../domain/mapping/compare/comparePageSession';
import type { LayoutCapture } from '../../domain/core/diagrams/layoutTemplate';
const origin = process.argv[2] ?? 'http://localhost:5191', requestId = process.argv[3] ?? randomUUID();
const documentId = 'representation-b697fd11-5c8d-49e7-a6b5-b12030f2f79a';
const id = (purpose: string) => {
  const h = createHash('sha256').update(`${requestId}:${purpose}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
async function api<T>(route: string, body?: unknown): Promise<T> {
  const response = await fetch(origin + '/api/mapping/' + route, body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  const value = await response.json();
  if (!response.ok) throw Error(`${route}: ${JSON.stringify(value)}`);
  return value;
}
const candidates = await api<CompareCandidate[]>('compare-sessions/candidates');
const candidate = candidates.find(item => item.documentId === documentId && !item.viewId);
if (!candidate) throw Error('Canvas-domain baseline is unavailable.');
const source = { documentId, checkpointId: candidate.checkpointId };
const target = await api<CompareCanvasCopy>('evals/capture', { source });
const diagrams = canvasContext(target, false).diagrams.sort((a, b) => a.position.row - b.position.row || a.position.column - b.position.column);
const first = diagrams[0];
if (!('ascii' in first) || !first.sourceContext?.binding || first.sourceContext.binding.corpus.kind !== 'git-worktree') throw Error('Target needs pinned Git evidence.');
const revision = first.sourceContext.binding.corpus.revision;
if (!revision || !/^[a-f0-9]{40}$/.test(revision)) throw Error('Target must pin an exact Git commit.');
const paths = [...new Set(Object.values(first.sourceContext.evidence ?? {}).flatMap(entity => entity.sourceRanges.map(range => range.path)))].sort();
if (!paths.length) throw Error('No target source files were found.');
const files = paths.map(path => ({ path, revision, content: execFileSync('git', ['show', `${revision}:${path}`], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }) }));
const context = await api<{ agentContextId: string }>('agent/tools/create-agent-context', {
  requestId: id('context'), name: 'Canvas-domain · pre-tldraw source · few-shot refinement',
  description: `Exact ${revision} source for the first canvas-domain diagram; ${files.length} complete files. Target ASCII is excluded.`,
  context: JSON.stringify({ revision, files })
});
const capture = await api<LayoutCapture>('evals/layout-templates/capture', source);
if (capture.geometry.slots.length !== diagrams.length) throw Error('Expand the target diagrams before capturing the template.');
capture.geometry.slots = capture.geometry.slots.map((slot, i) => {
  const d = diagrams[i]; if (!('ascii' in d)) throw Error('Expected full diagram content.');
  return { id: slot.id, title: d.ascii.split('\n').find(line => line.trim())!.trim().slice(0, 160), position: slot.position, size: slot.size };
});
const template = await api<{ id: string }>('evals/layout-templates', { requestId: id('full-template'), name: 'Canvas-domain baseline · titles and dimensions', capture });
const firstTemplate = await api<{ id: string }>('evals/layout-templates', { requestId: id('first-template'), name: 'Canvas-domain · first diagram · title and dimensions',
  capture: { source, geometry: { ...capture.geometry, placement: { version: 2, gap: 3 }, slots: [{ ...capture.geometry.slots[0], position: { column: 0, row: 0 } }] } } });
console.log(JSON.stringify({ requestId, revision, source, contextId: context.agentContextId, files: files.length, sourceBytes: JSON.stringify(files).length, templateId: template.id, firstTemplateId: firstTemplate.id }));
if (!process.argv.includes('--prepare-only')) {
  const run = await api<{ id: string; status: string }>('evals/runs', { requestId, workflow: 'few-shot-refinement',
    prompts: [{ promptId: 'builtin-few-shot-refinement', version: (await api<{ versions: { version: number }[] }>('evals/prompts/builtin-few-shot-refinement')).versions.at(-1)!.version }], inputs: { context: { agentContextId: context.agentContextId }, target: source },
    layoutTemplateId: firstTemplate.id, passes: 3, model: 'gpt-6-astra', effort: 'high' });
  console.log(JSON.stringify({ runId: run.id, status: run.status, url: `${origin}/evals?judgements=&run=${run.id}&judgement=${run.id}-progress` }));
}
