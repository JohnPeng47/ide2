import { genAlternativesSchema, genAlternativesDescription } from '../../../domain/core/diagrams/canvasGeneration';
import { directOperationSchemas, directDiagramInstructions, isDiagramTool, type DiagramTool } from '../../../domain/mapping/agent/diagramBatch';
import { diagramOutputFormat } from '../../../domain/mapping/agent/promptTemplates';
import { canvasViewCommandSchema, canvasViewInstructions } from '../../../domain/core/diagrams/canvasView';
import { projectDiagramsSchema } from '../../../domain/core/diagrams/highlightProjection';
import { highlightColorSchema, highlightTargetsSchema, highlightNodeIds } from '../../../domain/core/diagrams/diagramHighlight';
import type { CanvasMutationResult } from '../../../domain/mapping/agent/mutationReceipt';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { EditDiagramInput } from '../../../domain/mapping/agent/diagramEdit';
import type { LiveDocumentSnapshot } from '../../../domain/mapping/agent/contracts';
import { diagramContentNodes } from '../../../domain/core/diagrams/diagramContentNodes';
import { diagramReplacementRanges, diagramSubtreeRange } from '../../../domain/core/diagrams/diagramSubtreeEdit';
import { findBox } from '../../../domain/mapping/workspace/canvasDisplayNode';
import type { AgentDiagrammingSessionService } from '../agent/sessionService';
import type { ChatTools, ChatToolSession } from './ports';

const targetFields = { reference: z.number().int().min(1).max(20).optional(), nodeId: z.string().min(1).max(200).optional(), baseRevisionId: z.string().min(1).max(200).optional(),
  contentNodeIds: z.array(z.string().min(1).max(500)).min(1).max(100).optional() };
const chatOperationSchemas = {
  'edit-diagram': directOperationSchemas['edit-diagram'].omit({ nodeId: true, baseRevisionId: true, subtree: true, subtrees: true }).extend(targetFields).strict(),
  'create-diagram': directOperationSchemas['create-diagram'].omit({ nodeId: true, baseRevisionId: true }).extend(targetFields).strict(),
  'extend-diagram': directOperationSchemas['extend-diagram'].omit({ nodeId: true, baseRevisionId: true }).extend(targetFields).strict()
};
const chatSchemas = {
  'edit-diagram': z.object({ requestId: z.string().min(1).max(200), operations: z.array(chatOperationSchemas['edit-diagram']).min(1).max(20) }).strict(),
  'create-diagram': z.object({ requestId: z.string().min(1).max(200), operations: z.array(chatOperationSchemas['create-diagram']).min(1).max(20) }).strict(),
  'extend-diagram': z.object({ requestId: z.string().min(1).max(200), operations: z.array(chatOperationSchemas['extend-diagram']).min(1).max(20) }).strict()
};
type ChatDiagramInput = z.infer<typeof chatSchemas[DiagramTool]>;
const viewSchema = canvasViewCommandSchema.extend({ requestId: z.string().min(1).max(200) }).strict();
const contextSchema = z.object({ operation: z.enum(['prepare', 'read', 'delete']), reference: z.number().int().min(1).max(20).optional(),
  nodeId: z.string().min(1).max(200).optional(), requestId: z.string().min(1).max(200) }).strict();
const runSchema = z.object({ runId: z.string().min(1).max(200) }).strict();
const highlightTargetFields = { reference: z.number().int().min(1).max(20).optional(), nodeId: z.string().min(1).max(200).optional(), requestId: z.string().min(1).max(200) };
const highlightSchema = highlightTargetsSchema.safeExtend({ ...highlightTargetFields, color: highlightColorSchema.optional() }).strict();
const removeHighlightsSchema = z.object({ ...highlightTargetFields, highlightIds: z.array(z.string().min(1).max(200)).min(1).max(2000).optional() }).strict();

/** Bind native chat tools to the same live revision workflow as the LLM panel. */
export class ChatDiagramTools implements ChatTools {
  definitions: ChatTools['definitions'] = [
    { type: 'function', name: 'gen-alternatives', description: genAlternativesDescription, inputSchema: z.toJSONSchema(genAlternativesSchema) },
    { type: 'function', name: 'project-diagrams', description: 'Copy any specified diagrams from the current canvas into a new child canvas and open it. Pass only diagramIds: the diagram display IDs from Read Canvas (grid:… or current read aliases), not content or revision IDs. Highlights are not required. Preserves internal connections and copied source mappings, adds a blank 65 × 35 diagram, and arranges the group with adjustable Projection layout controls. The source is unchanged. Automatically persisted and undoable. Requires Workspace access.', inputSchema: z.toJSONSchema(projectDiagramsSchema) },
    { type: 'function', name: 'highlight-node', description: 'Only when explicitly requested by the user: save a colored highlight on a diagram or selected nodes. Specify either reference ([ref N] from the latest user message) or nodeId from Read Canvas, with optional contentNodeIds for multiple current full-ID anchors or contentNodeId for one. All targets must belong to that diagram. A selected nodes reference saves one highlight spanning all its members. The group shares one saved ID, color, and markdownUrl; removing the ID removes the entire group. Optional color: yellow (default), blue, green, pink, purple, orange or #RRGGBB. Returns saved highlight IDs and markdownUrl destinations for explicitly requested links. Undoable, automatically persisted. Requires Workspace access. Use a unique requestId; retry identical arguments with the same ID.', inputSchema: z.toJSONSchema(highlightSchema) },
    { type: 'function', name: 'remove-highlights', description: 'Remove saved diagram highlights when the user requests it. Specify reference or nodeId, plus optional highlightIds to remove specific annotations. Omit highlightIds to clear all highlights in that diagram. Undoable and automatically persisted. Requires Workspace access. Retry identical arguments with the same requestId.', inputSchema: z.toJSONSchema(removeHighlightsSchema) },
    { type: 'function', name: 'canvas-view', description: canvasViewInstructions, inputSchema: z.toJSONSchema(viewSchema) },
    ...(['edit-diagram', 'create-diagram', 'extend-diagram'] as const).map(name => ({ type: 'function' as const, name, description: directDiagramInstructions(name) + diagramOutputFormat(name, 'optional', `${name} using operations[].${name === 'edit-diagram' ? 'edit' : 'diagram'}`), inputSchema: z.toJSONSchema(chatSchemas[name]) })),
    { type: 'function', name: 'diagram-agent-context', description: 'Prepare, read, or delete a diagram-owned AgentContext. Specify operation and either a selected reference or a diagram nodeId from Read Canvas. A node selection targets its owning diagram. Prepare compiles current source evidence into a dedicated disk record for later diagram edits; read loads the stored context and reports whether its source evidence is current; delete removes the diagram binding. Prepare and delete are undoable and require Workspace access. Retry identical mutation arguments with the same requestId after an uncertain outcome.', inputSchema: z.toJSONSchema(contextSchema) },
    { type: 'function', name: 'edit-diagram-status', description: 'Check a diagram edit started by this conversation. Completed means the browser applied the revision and persisted workspace history. For awaiting-acknowledgement, retry the original edit-diagram arguments and requestId.', inputSchema: z.toJSONSchema(runSchema) },
    { type: 'function', name: 'cancel-diagram-edit', description: 'Cancel a diagram edit from this conversation while it is generating. Application already in progress cannot be undone by cancellation; inspect the returned status.', inputSchema: z.toJSONSchema(runSchema) }
  ];
  private highlightRequests = new Map<string, { signature: string; prepared: Promise<{ input: Record<string, unknown>; documentId: string }> }>();
  private attachments = new Map<string, Promise<string>>();
  private requests = new Map<string, { signature: string; input: Promise<unknown> }>();
  private contextRequests = new Map<string, { signature: string; prepared: Promise<Record<string, unknown>> }>();
  private viewRequests = new Map<string, { signature: string; prepared: Promise<Record<string, unknown>> }>();
  private owners = new Map<string, string>();
  private projectionRequests = new Map<string, { signature: string; prepared: Promise<{ workspaceInstanceId: string; documentId: string; payload: { diagramIds: string[]; expectedVersion: number; requestId: string } }> }>();
  constructor(private agent: Pick<AgentDiagrammingSessionService, 'call' | 'bridge' | 'submitDirect' | 'projection' | 'resolveDiagramArguments'>) {}
  async call(name: string, raw: unknown, session: ChatToolSession) {
    if (name === 'project-diagrams') return this.projectDiagrams(raw, session);
    if (name === 'highlight-node' || name === 'remove-highlights') return this.highlight(name, raw, session);
    if (name === 'canvas-view') return this.canvasView(raw, session);
    if (name === 'diagram-agent-context') return this.prepareContext(raw, session);
    if (!isDiagramTool(name)) {
      if (name !== 'edit-diagram-status' && name !== 'cancel-diagram-edit') throw Error('Unknown diagram tool');
      const input = runSchema.parse(raw);
      if (this.owners.get(input.runId) !== session.id) throw Error('This edit run does not belong to this conversation, or the backend was restarted.');
      return this.agent.call(name, input);
    }
    if (session.settings.sandbox === 'read-only') throw Error('Diagram editing requires Workspace access. Change Agent Chat access from Read only to Workspace.');
    const input = chatSchemas[name].parse(raw);
    const key = JSON.stringify([session.id, input.requestId]), signature = JSON.stringify({ name, input });
    let request = this.requests.get(key);
    if (request && request.signature !== signature) throw Error('REQUEST_ID_CONFLICT: edit arguments differ');
    if (!request) {
      if (this.requests.size >= 500) throw Error('Chat edit capacity reached; restart the backend.');
      request = { signature, input: this.prepare(input, session, name).catch(error => { this.requests.delete(key); throw error; }) };
      this.requests.set(key, request);
    }
    const result = await this.agent.submitDirect(name, await request.input);
    this.owners.set(result.runId, session.id);
    return result;
  }
  private async projectDiagrams(raw: unknown, session: ChatToolSession) {
    const input = projectDiagramsSchema.parse(raw);
    if (session.settings.sandbox === 'read-only') throw Error('Projecting diagrams requires Workspace access.');
    const canvas = session.canvasContext?.canvas;
    if (!canvas) throw Error('Open a live canvas and send another message or use Read Canvas.');
    // The transport supplies retry identity, keeping the agent-facing arguments to just IDs.
    const key = JSON.stringify([session.id, session.toolCallId ?? randomUUID()]), signature = JSON.stringify(input);
    let request = this.projectionRequests.get(key);
    if (request && request.signature !== signature) throw Error('REQUEST_ID_CONFLICT: projection arguments differ');
    if (!request) {
      if (this.projectionRequests.size >= 500) throw Error('Projection request capacity reached; restart the backend.');
      const prepare = async () => {
        const sessionId = await this.attachment(canvas);
        const resolved = this.agent.resolveDiagramArguments(sessionId, input);
        const state = await this.agent.bridge.dispatch(canvas.workspaceInstanceId,
          { method: 'identity', documentId: canvas.documentId }) as { version: number };
        return { ...canvas, payload: { ...resolved, expectedVersion: state.version, requestId: randomUUID() } };
      };
      request = { signature, prepared: prepare().catch(error => { this.projectionRequests.delete(key); throw error; }) };
      this.projectionRequests.set(key, request);
    }
    const prepared = await request.prepared;
    return this.agent.bridge.dispatch(prepared.workspaceInstanceId,
      { method: 'project-diagrams', documentId: prepared.documentId, payload: prepared.payload });
  }
  private async canvasView(raw: unknown, session: ChatToolSession) {
    const input = viewSchema.parse(raw), read = ['list', 'read'].includes(input.operation);
    if (!read && session.settings.sandbox === 'read-only') throw Error('CanvasView changes require Workspace access.');
    const canvas = session.canvasContext?.canvas;
    if (!canvas) throw Error('Open a live canvas and send another message or use Read Canvas.');
    const prepare = async () => {
      const sessionId = await this.attachment(canvas);
      const state = read ? undefined : await this.agent.bridge.dispatch(canvas.workspaceInstanceId,
        { method: 'identity', documentId: canvas.documentId }) as { version: number };
      return { ...input, sessionId, requestId: randomUUID(), ...(state ? { expectedVersion: state.version } : {}) };
    };
    if (read) return this.agent.call('canvas-view', await prepare());
    const key = JSON.stringify([session.id, input.requestId]), signature = JSON.stringify(input);
    let request = this.viewRequests.get(key);
    if (request && request.signature !== signature) throw Error('REQUEST_ID_CONFLICT: CanvasView arguments differ');
    if (!request) {
      if (this.viewRequests.size >= 500) throw Error('CanvasView request capacity reached; restart the backend.');
      request = { signature, prepared: prepare().catch(error => { this.viewRequests.delete(key); throw error; }) };
      this.viewRequests.set(key, request);
    }
    return this.agent.call('canvas-view', await request.prepared);
  }
  private async prepareContext(raw: unknown, session: ChatToolSession) {
    const input = contextSchema.parse(raw);
    if (session.settings.sandbox === 'read-only' && input.operation !== 'read') throw Error('Diagram context changes require Workspace access. Change Agent Chat access from Read only to Workspace.');
    if ((input.reference === undefined) === (input.nodeId === undefined)) throw Error('Specify either reference or nodeId.');
    const key = JSON.stringify([session.id, input.requestId]), signature = JSON.stringify(input);
    let request = this.contextRequests.get(key);
    if (request && request.signature !== signature) throw Error('REQUEST_ID_CONFLICT: context arguments differ');
    if (!request) {
      if (this.contextRequests.size >= 500) throw Error('Chat context preparation capacity reached; restart the backend.');
      request = { signature, prepared: this.prepareContextInput(input, session).catch(error => { this.contextRequests.delete(key); throw error; }) };
      this.contextRequests.set(key, request);
    }
    return this.agent.call('diagram-agent-context', await request.prepared);
  }
  private async prepareContextInput(input: z.infer<typeof contextSchema>, session: ChatToolSession) {
    const reference = input.reference === undefined ? undefined : session.canvasContext?.references[input.reference - 1];
    if (input.reference !== undefined && !reference) throw Error('Reference unavailable. Select the diagram and send it with your message.');
    const canvas = reference?.canvas ?? session.canvasContext?.canvas;
    if (!canvas) throw Error('Open a live canvas and send another message or use Read Canvas.');
    const nodeId = reference?.displayNodeId ?? input.nodeId!;
    const snapshot = await this.agent.bridge.dispatch(canvas.workspaceInstanceId, { method: 'snapshot', documentId: canvas.documentId }) as LiveDocumentSnapshot;
    const box = nodeId.startsWith('grid:') && findBox(snapshot.document.scene.root, nodeId.slice(5));
    const diagram = box && box.kind === 'diagram' ? snapshot.document.scene.contents[box.contentId] : undefined;
    if (!diagram) throw Error('The target diagram is no longer available. Read Canvas again.');
    if (reference && (reference.reference.diagramId !== diagram.diagramId || reference.reference.revisionId !== diagram.revisionId))
      throw Error('VERSION_CONFLICT: the referenced diagram changed. Reselect it and send the current reference.');
    return { operation: input.operation, sessionId: await this.attachment(canvas), requestId: randomUUID(), nodeId,
      ...(input.operation === 'read' ? {} : { expectedVersion: snapshot.version, expectedRevisionId: diagram.revisionId }) };
  }
  private async highlight(name: 'highlight-node' | 'remove-highlights', raw: unknown, session: ChatToolSession) {
    if (session.settings.sandbox === 'read-only') throw Error('Highlights require Workspace access. Change Agent Chat access from Read only to Workspace.');
    const input = name === 'highlight-node' ? highlightSchema.parse(raw) : removeHighlightsSchema.parse(raw);
    if ((input.reference === undefined) === (input.nodeId === undefined)) throw Error('Specify either reference or nodeId.');
    if (input.reference !== undefined && ('contentNodeId' in input || 'contentNodeIds' in input)) throw Error('Use either selected reference nodes or explicit contentNodeId/contentNodeIds with nodeId.');
    const key = JSON.stringify([session.id, input.requestId]), signature = JSON.stringify([name, input]);
    let request = this.highlightRequests.get(key);
    if (request && request.signature !== signature) throw Error('REQUEST_ID_CONFLICT: highlight arguments differ');
    if (!request) {
      if (this.highlightRequests.size >= 500) throw Error('Chat highlight capacity reached; restart the backend.');
      request = { signature, prepared: this.prepareHighlight(name, input, session).catch(error => { this.highlightRequests.delete(key); throw error; }) };
      this.highlightRequests.set(key, request);
    }
    const prepared = await request.prepared;
    const result = await this.agent.call('exec', prepared.input) as { transaction: CanvasMutationResult };
    return { documentId: prepared.documentId, version: result.transaction.version, nodeId: result.transaction.receipts[0]?.nodeId,
      highlights: result.transaction.receipts.filter(item => item.method === 'highlight' && item.highlightId)
        .map(item => ({ id: item.highlightId!, nodeId: item.nodeId, color: item.color, status: item.status, markdownUrl: item.markdownUrl })) };
  }
  private async prepareHighlight(name: string, input: z.infer<typeof highlightSchema> | z.infer<typeof removeHighlightsSchema>, session: ChatToolSession) {
    const reference = input.reference === undefined ? undefined : session.canvasContext?.references[input.reference - 1];
    if (input.reference !== undefined && !reference) throw Error('Reference unavailable. Select the target and send it with your message.');
    const canvas = reference?.canvas ?? session.canvasContext?.canvas;
    if (!canvas) throw Error('Open a live canvas and send another message or use Read Canvas.');
    const nodeId = reference?.displayNodeId ?? input.nodeId!;
    const snapshot = await this.agent.bridge.dispatch(canvas.workspaceInstanceId, { method: 'read', documentId: canvas.documentId, payload: { level: 'small', nodeIds: [nodeId] } }) as { version: number; nodes: { id: string; diagram?: { diagramId: string; revisionId: string }; content?: { structure: { nodes: Record<string, { id: string }> } } }[] };
    const node = snapshot.nodes.find(n => n.id === nodeId), diagram = node?.diagram;
    if (!diagram) throw Error('The target diagram is no longer available. Read Canvas again.');
    if (reference && (reference.reference.diagramId !== diagram.diagramId || reference.reference.revisionId !== diagram.revisionId))
      throw Error('VERSION_CONFLICT: the referenced diagram changed. Reselect it and send the current reference.');
    const targets = reference?.reference.kind === 'nodes' ? reference.reference.nodeIds : highlightNodeIds('contentNodeId' in input || 'contentNodeIds' in input ? input : {});
    if (targets.length > 2000 || reference?.reference.kind === 'nodes' && !targets.length) throw Error('Highlight between 1 and 2000 nodes per group.');
    if (name === 'highlight-node' && targets.some(id => id && !Object.values(node?.content?.structure.nodes ?? {}).some(n => n.id === id)))
      throw Error('STALE_CONTENT_NODE: read current full-ID anchors or select the nodes again.');
    const code = name === 'remove-highlights'
      ? `return nodes.removeHighlights(${JSON.stringify({ nodeId, ...('highlightIds' in input ? { highlightIds: input.highlightIds } : {}) })});`
      : `return nodes.highlight(${JSON.stringify({ nodeId, ...(targets.length ? { contentNodeIds: targets } : {}), ...('color' in input ? { color: input.color } : {}) })});`;
    return { documentId: canvas.documentId, input: { sessionId: await this.attachment(canvas), expectedVersion: snapshot.version,
      requestId: randomUUID(), code } };
  }
  private async attachment(canvas: { workspaceInstanceId: string; documentId: string }) {
    const key = JSON.stringify(canvas);
    let attachment = this.attachments.get(key);
    if (!attachment) {
      attachment = this.agent.call('exec', { requestId: randomUUID(), code: `return canvas.attach(${JSON.stringify({ canvasId: canvas.workspaceInstanceId, documentId: canvas.documentId })});` })
        .then(result => (result as { value: { sessionId: string } }).value.sessionId)
        .catch(error => { this.attachments.delete(key); throw error; });
      this.attachments.set(key, attachment);
    }
    return attachment;
  }
  private async prepare(input: ChatDiagramInput, session: ChatToolSession, operation: DiagramTool): Promise<unknown> {
    const prepared: Record<string, unknown>[] = [];
    let canvas: { workspaceInstanceId: string; documentId: string } | undefined;
    let snapshot: LiveDocumentSnapshot | undefined;
    for (let index = 0; index < input.operations.length; index++) {
      try {
        let item = input.operations[index];
        if ((item.reference === undefined) === (item.nodeId === undefined)) throw Error('Specify either reference or nodeId');
        const reference = item.reference === undefined ? undefined : session.canvasContext?.references[item.reference - 1];
        if (item.reference !== undefined && !reference) throw Error('Reference unavailable; select it again');
        const target = reference?.canvas ?? session.canvasContext?.canvas;
        if (!target) throw Error('Open a live canvas and read it again');
        if (canvas && (canvas.workspaceInstanceId !== target.workspaceInstanceId || canvas.documentId !== target.documentId)) throw Error('Batch operations must target one canvas document');
        canvas = target;
        item = this.agent.resolveDiagramArguments(await this.attachment(canvas), item);
        snapshot ??= await this.agent.bridge.dispatch(canvas.workspaceInstanceId, { method: 'snapshot', documentId: canvas.documentId }) as LiveDocumentSnapshot;
        const nodeId = reference?.displayNodeId ?? item.nodeId!;
        const box = nodeId.startsWith('grid:') && findBox(snapshot.document.scene.root, nodeId.slice(5));
        const diagram = box && box.kind === 'diagram' ? snapshot.document.scene.contents[box.contentId] : undefined;
        const unanchored = operation === 'create-diagram' && nodeId === 'canvas';
        if (!diagram && !unanchored) throw Error('Target diagram unavailable');
        const baseRevisionId = reference?.reference.revisionId ?? item.baseRevisionId;
        if (reference && item.baseRevisionId && item.baseRevisionId !== reference.reference.revisionId) throw Error('VERSION_CONFLICT: baseRevisionId disagrees with the reference');
        if (!baseRevisionId || diagram && (baseRevisionId !== diagram.revisionId || reference && reference.reference.diagramId !== diagram.diagramId))
          throw Error('VERSION_CONFLICT: read the current diagram and supply its baseRevisionId');
        const { reference: _ref, contentNodeIds: _ids, ...fields } = item;
        let subtree: EditDiagramInput['subtree'], subtrees: EditDiagramInput['subtrees'];
        if (operation === 'edit-diagram' && 'replace-mode' in item && diagram) {
          let rootIds = item.contentNodeIds?.map(id => this.agent.projection.resolveAnchorId(id));
          if (reference?.reference.kind === 'nodes') {
            if (rootIds) throw Error('Use the reference selection or contentNodeIds, not both');
            if (item['replace-mode'] === 'diagram') throw Error('A node selection requires a subtree replace-mode');
            const ids = new Set(reference.reference.nodeIds), nodes = diagramContentNodes(diagram.content);
            const roots = nodes.filter(node => ids.has(node.id) && (!node.parentId || !ids.has(node.parentId)));
            const members = new Set(roots.flatMap(root => {
              const range = diagramSubtreeRange(diagram, root.id);
              return nodes.filter(node => node.line >= range.startLine && node.line <= range.endLine).map(node => node.id);
            }));
            if (!roots.length || members.size !== ids.size || [...members].some(id => !ids.has(id))) throw Error('Select complete subtrees without excluded nodes');
            rootIds = roots.map(root => root.id);
          }
          if (item['replace-mode'] === 'diagram' && rootIds) throw Error('diagram mode cannot include subtree targets');
          if (item['replace-mode'] === 'subnode-single' && rootIds?.length !== 1 && !(item.variant?.variantId && !rootIds)) throw Error('subnode-single requires one complete subtree');
          const targets = rootIds?.map(contentNodeId => ({ contentNodeId, revisionId: diagram.content.revisionId }));
          subtree = item['replace-mode'] === 'subnode-single' ? targets?.[0] : undefined;
          subtrees = item['replace-mode'].startsWith('multi-') ? targets : undefined;
          if (!item.variant?.variantId) diagramReplacementRanges(diagram, item['replace-mode'], subtree, subtrees);
        } else if (item.contentNodeIds) throw Error('contentNodeIds applies only to edit-diagram');
        prepared.push({ ...fields, nodeId, baseRevisionId, ...(subtree ? { subtree } : {}), ...(subtrees ? { subtrees } : {}) });
      } catch (error) { throw Error(`operations[${index}]: ${String(error)}`); }
    }
    return { sessionId: await this.attachment(canvas!), expectedVersion: snapshot!.version, requestId: randomUUID(), operations: prepared };
  }
}
