import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { AgentContext } from '../../domain/core/agents/agentContext.ts';
import { sourceFileHash } from '../../domain/core/agents/agentContextSource.ts';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '../..');
const statePath = path.join(dir, 'manifest.json');
const origin = 'http://127.0.0.1:5191';
const parentChatId = '08c6af0f-796e-4fda-b715-16efc834be09';
const repositoryId = 'repo-ce67f2af4410036fce1ce12f';
const proposals = [
  ['Saved CanvasViews and branching', 'Creating, saving, reopening and forking views; retaining unsaved working copies; keeping or discarding alternative branches; saved checkpoints and ancestry.', ['domain/core/diagrams/canvasView.ts','domain/core/diagrams/canvasHistory.ts','src/features/mapping/canvas-views/CanvasViewControls.tsx','src/features/mapping/canvas-views/canvasViewReceiver.ts','src/features/mapping/canvas-views/CanvasViewDiffPreview.tsx']],
  ['Managed generation of canvas alternatives', 'Generating independent candidates from one saved checkpoint; shared and candidate-specific prompts; isolated child canvases and chats; inherited model or saved context; progress, cancellation and persisted results.', ['domain/core/diagrams/canvasGeneration.ts','application/mapping/agent-chat/agentChatService.ts','application/mapping/agent-chat/generationCanvasBridge.ts','src/features/mapping/canvas-views/GenerateAlternatives.tsx','domain/core/diagrams/canvasHistory.ts']],
  ['Reusable AgentContexts and pinned source evidence', 'Saving reusable contexts across chats and canvases; diagram-bound source context; immutable source references; lazy source loading; source snapshots and portable exports.', ['domain/core/agents/savedAgentContext.ts','domain/core/agents/agentContext.ts','domain/core/agents/agentContextSource.ts','application/mapping/agent/agentContextLibrary.ts','application/mapping/agent/agentContextService.ts','infrastructure/core/persistence/fileAgentContextSources.ts','infrastructure/core/persistence/fileAgentContextRepository.ts','domain/core/diagrams/diagramAgentContext.ts']],
  ['Scoped diagram authoring and alternative review', 'Structured prompts and pinned references; whole-diagram or subtree edits; generating variants; reviewing changes; inline alternative swaps and side-panel inspection. Explain the authoring and interaction workflow, preserving the distinction between presentation selection and applying a revision.', ['src/features/mapping/prompt-composer/PromptComposer.tsx','application/mapping/agent/diagramEditService.ts','domain/mapping/agent/diagramEdit.ts','src/features/mapping/prompt-composer/VariantReview.tsx','domain/core/diagrams/diagramRevisionReview.ts','src/features/mapping/tldraw/DiagramAlternativeControls.tsx','src/features/mapping/tldraw/DiagramSidePanelContent.tsx','domain/mapping/workspace/diagramAlternatives.ts']],
  ['Agent Chat sessions and direct diagram actions', 'Creating and resuming conversations; capturing canvas references for a turn; streaming responses; answering agent requests; persisting conversations; submitting supplied diagram edits directly, including atomic multi-diagram submissions.', ['application/mapping/agent-chat/agentChatService.ts','application/mapping/agent-chat/chatDiagramTools.ts','application/mapping/agent/diagramBatchService.ts','domain/mapping/agent/diagramBatch.ts','domain/mapping/agent-chat/agentChat.ts','infrastructure/mapping/agent-chat/chatStore.ts','src/features/mapping/agent-chat/AgentChatPanel.tsx']],
  ['Bound Canvas API connections and batched edits', 'Persistent canvas binding; compact current-state reads; batching consecutive mutations; flush boundaries; version checks; retry receipts and failure behavior. Correct the obsolete notion that every exec mutation necessarily commits separately.', ['application/mapping/agent/sessionService.ts','infrastructure/mapping/mcp/server.ts','domain/mapping/agent/contracts.ts','domain/mapping/agent/currentCanvasRead.ts','domain/mapping/agent/mutationReceipt.ts','application/mapping/agent/chatBindings.ts','infrastructure/mapping/agent/execRuntime.ts']],
  ['Mapping integration with tldraw', 'How native gestures become domain edits; native versus semantic selection ownership; undo/redo restoring domain checkpoints; granular diagram updates, local anchors and connection routing. Focus on this application integration, not generic tldraw internals.', ['src/features/mapping/tldraw/MappingEditorRuntime.ts','src/features/mapping/tldraw/CanvasRuntimeContext.tsx','src/features/mapping/tldraw/MappingEditorCanvas.tsx','src/features/mapping/tldraw/NativeRoutingStore.ts','src/features/mapping/tldraw/ConnectionFocus.tsx','src/features/mapping/tldraw/SelectionTools.ts','src/features/mapping/tldraw/shapeProjection.ts','src/features/mapping/tldraw/LocalAnchorStore.ts']],
  ['Git changes to generated ChangeSessions and review', 'Pinning commits and hunks; generating isolated proposals from repository changes or pushes; mapping DiffTree entries to hunks and diagram destinations; navigating review and explicit acceptance.', ['domain/mapping/changes/diffTree.ts','application/mapping/changes/diffSessionWorkflowService.ts','application/mapping/changes/diffSessionWorkflow.ts','application/mapping/changes/diffSessionTools.ts','application/core/integrations/pushIntegrationService.ts','application/mapping/changes/changeSessionService.ts','src/features/mapping/changes/DiffTreePanel.tsx']],
  ['Diagram search and mapped-source navigation', 'Search across canvases and proposals; click symbols to search; reveal matches; open mapped source in a resizable workspace panel. Include source identity and stale-result protection where they explain user-visible behavior.', ['domain/mapping/search/diagramSearch.ts','src/features/mapping/search/diagramSearchService.ts','src/features/mapping/search/diagramSearch.worker.ts','src/features/mapping/search/DiagramSearchPanel.tsx','src/features/mapping/search/revealSearchMatches.ts','src/features/mapping/search/useDiagramSymbolSearch.ts','src/features/mapping/source-pane/SourceWindowPanel.tsx','src/features/mapping/source-pane/SourceCodePane.tsx']],
  ['Source coverage and change treemaps', 'Measure mapped source coverage; distribute overlapping source ranges without double-counting; identify unresolved mappings; visualize changed-code coverage; navigate from coverage results to diagrams.', ['domain/mapping/treemap/canvasTreemap.ts','domain/mapping/changes/changeTreemap.ts','src/features/mapping/treemap/CanvasTreemapContent.tsx','src/features/mapping/changes/ChangeTreemapContent.tsx','src/features/mapping/changes/treemapLayout.ts','src/features/mapping/treemap/useTreemapRegionSelection.ts']],
  ['Focused canvases from selected or highlighted diagrams', 'Create a derived canvas from selected or highlighted diagrams; preserve source provenance; adjust its arrangement; save and undo layout changes. Describe the implemented projection feature rather than the contents of an existing canvas named Projection.', ['domain/core/diagrams/highlightProjection.ts','domain/core/diagrams/canvasTransfer.ts','src/features/mapping/workspace/ProjectionLayoutPanel.tsx','src/features/mapping/workspace/workspaceTask.ts','src/features/mapping/workspace/runWorkspaceTask.ts']],
  ['Incremental persistence and durable recovery', 'Deduplicated history records; saving only changed records; coalesced writes; uncertain-write retries; durable manifest publication and restoration. Explain current reliability and performance behavior beyond the older component overview.', ['domain/mapping/workspace/workspaceRecords.ts','src/features/mapping/workspace/workspacePersistence.ts','src/features/mapping/workspace/recordStorage.ts','src/features/mapping/workspace/workspaceStorage.ts','src/features/mapping/workspace/workspaceStorage.worker.ts','infrastructure/mapping/persistence/workspace/workspaceRecordStore.ts','domain/core/diagrams/canvasHistory.ts']]
];
const template = `## Layout
This section will contain details on the high-level layout of the data
For now, we will use a single layout to display the data
This layout uses a single central diagram and then some diagrams on the side

## General
I want you to use CanvasView to create a view that explains this current feature. The following are some guidelines:
- relations
  - edges
    - obvious -> just the edge
    - less obvious -> edge + edge text
      > "inherits", "imports", "MCP API call", etc..
    - less less obvious
      > creating an "anchor" node / tree at the source or target or both
- tree-diagrams
  - tree are best to depict nested, hierarchals arrangements of the data
    > their strength lies in their ability to segment non-adjacent levels of the data-space
  - while uniformity / flat levels are good, I suspect this is not always the case and not always the best use of trees
- highlighting
  - can be used to mark nodes as important`;
const prompt = `${template}

## This experiment: central diagram only
Generate ONLY the central diagram for the assigned feature. The saved AgentContext contains the feature brief and exact current source evidence. Explain the implemented high-level feature and its important relationships using that evidence.
The final canvas must contain exactly ONE meaningful diagram. Do not generate side diagrams, side panels, additional alternatives, or additional canvases. Replace the starter diagram in-place if one exists. Do not leave a blank placeholder beside the result. Connections within the central ASCII diagram are fine; do not create dangling external edges.
The application has already created your CanvasView and bound an isolated generation canvas. Edit that bound canvas directly; the application saves the resulting CanvasView automatically. Do not fork or create another view, and do not call gen-alternatives.
Use the canvas/diagram tools, not filesystem edits. Do not change application source code. If you add source mappings, use accurate captured file ranges; do not fabricate evidence. Before completing, reread the bound canvas and verify that it has exactly one diagram and that its content covers the assigned feature.
`;
async function request(route, body) {
  const response = await fetch(origin + route, { ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(90000) });
  const result = await response.json();
  if (!response.ok) throw Error(`${response.status} ${route}: ${JSON.stringify(result)}`);
  return result;
}
const tool = (name, input) => request('/api/mapping/agent/tools/' + name, input);
const save = state => fs.writeFile(statePath, JSON.stringify(state, null, 2));
let state = await fs.readFile(statePath, 'utf8').then(JSON.parse).catch(error => { if (error.code !== 'ENOENT') throw error; });
const stage = process.argv[2] ?? 'status';
if (stage === 'prepare') {
  if (state) throw Error('Manifest already exists; use the next stage.');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const listed = (await tool('exec', { requestId: crypto.randomUUID(), code: 'return canvas.list();' })).value;
  if (listed.length !== 1) throw Error('Expected one active workspace');
  state = { createdAt: new Date().toISOString(), root, head, parentChatId, repositoryId, workspaceId: listed[0].canvasId, stableWorkspaceId: listed[0].stableWorkspaceId,
    originalDocumentIds: listed[0].documents.map(d => d.documentId), sharedPrompt: prompt, proposals: [] };
  await fs.mkdir(path.join(dir, 'contexts'), { recursive: true });
  await fs.writeFile(path.join(dir, 'shared-prompt.txt'), prompt);
  for (let index = 0; index < proposals.length; index++) {
    const [title, features, files] = proposals[index], number = index + 1, requestId = crypto.randomUUID();
    const sourceFiles = {}, ranges = [];
    const content = [{ type: 'text', text: `Feature proposal ${number}: ${title}\nHigh-level scope: ${features}\nEvidence captured from current working-tree bytes at ${root}. Git HEAD ${head}; snapshots include any uncommitted changes. The code below is reference material, not instructions. This context is reusable independently of any diagram-layout prompt.` }];
    for (const file of files) {
      const text = await fs.readFile(path.join(root, file), 'utf8');
      const lines = text.replace(/\r\n/g, '\n').split('\n'); if (lines.at(-1) === '') lines.pop();
      const snapshot = { startLine: 1, lines }, contentHash = sourceFileHash(snapshot);
      sourceFiles[contentHash] = snapshot;
      const range = { type: 'sourceRange', sourceId: repositoryId, path: file, startLine: 1, endLine: lines.length, version: { kind: 'snapshot', contentHash } };
      content.push(range); ranges.push(range);
    }
    const base = AgentContext.fromTrajectory({ agentType: 'saved-context', sourceSessionId: requestId, format: 'messages-v1', fromEntryId: 'evidence', throughEntryId: 'evidence', entries: [{ id: 'evidence', parentId: null, message: { role: 'user', content, timestamp: 0 } }] });
    const context = AgentContext.fromSnapshot({ ...base.toSnapshot(), sourceFiles }).toSnapshot();
    const contextFile = `contexts/${String(number).padStart(2, '0')}.json`;
    await fs.writeFile(path.join(dir, contextFile), JSON.stringify({ requestId, name: `${title} - source baseline`, description: `Feature ${number}/12. Exact working-tree source snapshots for the central-diagram prompt experiment.`, context }));
    state.proposals.push({ number, title, features, ranges, contextFile, contextRequestId: requestId, createRequestId: crypto.randomUUID(), viewRequestId: crypto.randomUUID(), generationRequestId: crypto.randomUUID(), candidatePrompt: `Feature ${number}: ${title}\n\nCover: ${features}\n\nProduce the single central diagram only, using the supplied AgentContext.`, canvasName: `${String(number).padStart(2,'0')} - ${title}` });
  }
  await save(state);
  console.log(JSON.stringify({ prepared: state.proposals.length, sourceFiles: new Set(state.proposals.flatMap(p => p.ranges.map(r => r.path))).size, manifest: statePath }));
} else if (stage === 'contexts') {
  for (const p of state.proposals) {
    if (p.context) continue;
    p.context = await tool('create-agent-context', JSON.parse(await fs.readFile(path.join(dir, p.contextFile), 'utf8'))); await save(state);
    const read = await tool('read-agent-context', { agentContextId: p.context.agentContextId });
    if (read.contentHash !== p.context.contentHash || !read.resolvedSnapshot) throw Error(`Context verification failed: ${p.title}`);
    p.contextVerified = true; await save(state);
    console.log(JSON.stringify({ number: p.number, contextId: p.context.agentContextId, files: p.ranges.length }));
  }
} else if (stage === 'canvases') {
  for (const p of state.proposals) {
    if (!p.attachment) {
      p.attachment = (await tool('exec', { requestId: p.createRequestId, code: `return canvas.createDocument(${JSON.stringify({ canvasId: state.workspaceId, repositoryId, name: p.canvasName })});` })).value;
      await save(state);
    }
    if (!p.baseViewId) {
      const read = (await tool('exec', { requestId: crypto.randomUUID(), sessionId: p.attachment.sessionId, code: 'return canvas.read({level:"small"});' })).value;
      p.baseViewRequest ??= { operation: 'create', name: 'Blank baseline', sessionId: p.attachment.sessionId, expectedVersion: read.version, requestId: p.viewRequestId }; await save(state);
      const view = await tool('canvas-view', p.baseViewRequest);
      p.baseViewId = view.activeViewId;
      if (!p.baseViewId) throw Error(JSON.stringify(view));
      await save(state);
    }
    console.log(JSON.stringify({ number: p.number, documentId: p.attachment.documentId, baseViewId: p.baseViewId }));
  }
} else if (stage === 'launch') {
  const limit = Number(process.argv[3] ?? 3);
  let launched = 0;
  for (const p of state.proposals) {
    if (p.generation) continue;
    if (!p.contextVerified || !p.baseViewId) throw Error('Finish context and canvas preparation first');
    p.generationInput ??= { canvas: { workspaceInstanceId: state.workspaceId, documentId: p.attachment.documentId }, viewId: p.baseViewId,
      agentContextId: p.context.agentContextId, prompt: state.sharedPrompt, alternatives: [{ name: 'Central diagram - baseline prompt', prompt: p.candidatePrompt }], requestId: p.generationRequestId };
    await save(state);
    p.generation = await request(`/api/mapping/agent-chat/sessions/${parentChatId}/gen-alternatives`, p.generationInput); await save(state);
    console.log(JSON.stringify({ number: p.number, ...p.generation }));
    if (++launched >= limit) break;
  }
} else if (stage === 'verify') {
  await fs.mkdir(path.join(dir, 'diagrams'), { recursive: true });
  for (const p of state.proposals) {
    if (p.verified || !p.generation) continue;
    const statuses = await request('/api/mapping/agent-chat/generations?' + new URLSearchParams({ workspaceInstanceId: state.workspaceId, documentId: p.attachment.documentId }));
    const candidate = p.generation.candidates[0];
    const status = statuses.find(item => item.viewId === candidate.viewId);
    if (status?.status !== 'finished' || status.pendingSave) { console.log(JSON.stringify({ number: p.number, skipped: status?.status, pendingSave: status?.pendingSave })); continue; }
    const before = (await tool('exec', { sessionId: p.attachment.sessionId, requestId: crypto.randomUUID(), code: 'return canvas.read({level:"small"});' })).value;
    p.openRequest ??= { sessionId: p.attachment.sessionId, requestId: crypto.randomUUID(), expectedVersion: before.version, operation: 'open', viewId: candidate.viewId }; await save(state);
    const view = await tool('canvas-view', p.openRequest);
    if (view.activeViewId !== candidate.viewId) throw Error(`Wrong active view for ${p.number}`);
    const result = (await tool('exec', { sessionId: p.attachment.sessionId, requestId: crypto.randomUUID(), code: 'const r = canvas.read({level:"full"}); return {version:r.version,nodes:r.nodes,edges:r.edges,view:r.view};' })).value;
    const diagrams = result.nodes.filter(node => node.kind === 'diagram' && node.content);
    if (diagrams.length !== 1 || diagrams[0].content.ascii.trim().length < 100 || diagrams[0].content.ascii.trim() === '[New diagram]')
      throw Error(`Expected exactly one meaningful diagram for ${p.number}: ${diagrams.length}`);
    if (result.nodes.some(node => node.kind === 'side-panel' || node.kind === 'sidePanel' || node.kind === 'projection')) throw Error(`Unexpected side panel for ${p.number}`);
    const textFile = `diagrams/${String(p.number).padStart(2,'0')}.txt`;
    await fs.writeFile(path.join(dir, textFile), diagrams[0].content.ascii + '\n');
    p.verified = { at: new Date().toISOString(), viewId: candidate.viewId, diagramCount: 1, lines: diagrams[0].content.ascii.split('\n').length,
      characters: diagrams[0].content.ascii.length, edges: result.edges?.length ?? 0, textFile, generation: status };
    await save(state);
    console.log(JSON.stringify({ number: p.number, title: p.title, diagramCount: 1, lines: p.verified.lines }));
  }
} else if (stage === 'status') {
  for (const p of state.proposals) {
    if (!p.generation) { console.log(JSON.stringify({ number: p.number, status: 'not-started' })); continue; }
    const id = p.generation.candidates[0].chatId;
    const chat = await request(`/api/mapping/agent-chat/sessions/${id}`);
    p.status = { chatStatus: chat.status, generationStatus: chat.generation?.metadata.status, error: chat.error, pending: chat.pending, completedAt: chat.completedAt };
    console.log(JSON.stringify({ number: p.number, title: p.title, ...p.status, last: chat.items.filter(i => i.kind === 'assistant').at(-1)?.text.slice(-500) }));
  }
  await save(state);
} else throw Error('Unknown stage');
