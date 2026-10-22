import { highlightColorSchema, highlightTargetsSchema, highlightNodeIds } from '../../../domain/core/diagrams/diagramHighlight';
import type { CanvasMutationResult } from '../../../domain/mapping/agent/mutationReceipt';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { EditDiagramInput, DiagramEditRun } from '../../../domain/mapping/agent/diagramEdit';
import type { LiveDocumentSnapshot } from '../../../domain/mapping/agent/contracts';
import { diagramContentNodes } from '../../../domain/core/diagrams/diagramContentNodes';
import { diagramSubtreeRange } from '../../../domain/core/diagrams/diagramSubtreeEdit';
import { findBox } from '../../../domain/mapping/workspace/canvasDisplayNode';
import type { AgentDiagrammingSessionService } from '../agent/sessionService';
import type { ChatTools, ChatToolSession } from './ports';

const editSchema = z.object({
  reference: z.number().int().min(1).max(20).optional(), nodeId: z.string().min(1).max(200).optional(),
  prompt: z.string().trim().min(1).max(20_000), requestId: z.string().min(1).max(200)
}).strict();
const runSchema = z.object({ runId: z.string().min(1).max(200) }).strict();
const highlightTargetFields = { reference: z.number().int().min(1).max(20).optional(), nodeId: z.string().min(1).max(200).optional(), requestId: z.string().min(1).max(200) };
const highlightSchema = highlightTargetsSchema.safeExtend({ ...highlightTargetFields, color: highlightColorSchema.optional() }).strict();
const removeHighlightsSchema = z.object({ ...highlightTargetFields, highlightIds: z.array(z.string().min(1).max(200)).min(1).max(2000).optional() }).strict();

/** Bind native chat tools to the same live revision workflow as the LLM panel. */
export class ChatDiagramTools implements ChatTools {
  definitions: ChatTools['definitions'] = [
    { type: 'function', name: 'highlight-node', description: 'Only when explicitly requested by the user: save a colored highlight on a diagram or selected nodes. Specify either reference ([ref N] from the latest user message) or nodeId from Read Canvas, with optional contentNodeIds for multiple current full-ID anchors or contentNodeId for one. All targets must belong to that diagram. A selected nodes reference saves one highlight spanning all its members. The group shares one saved ID, color, and markdownUrl; removing the ID removes the entire group. Optional color: yellow (default), blue, green, pink, purple, orange or #RRGGBB. Returns saved highlight IDs and markdownUrl destinations for explicitly requested links. Undoable, automatically persisted. Requires Workspace access. Use a unique requestId; retry identical arguments with the same ID.', inputSchema: z.toJSONSchema(highlightSchema) },
    { type: 'function', name: 'remove-highlights', description: 'Remove saved diagram highlights when the user requests it. Specify reference or nodeId, plus optional highlightIds to remove specific annotations. Omit highlightIds to clear all highlights in that diagram. Undoable and automatically persisted. Requires Workspace access. Retry identical arguments with the same requestId.', inputSchema: z.toJSONSchema(removeHighlightsSchema) },
    { type: 'function', name: 'edit-diagram', description: 'Ask the diagram-edit LLM to revise a live diagram and apply one undoable, persisted revision. Specify either reference (the 1-based [ref N] from the latest user message), or nodeId (diagram id from Read Canvas, in the canvas active when the message was sent). Node references must select one complete subtree; a diagram reference edits the whole diagram. The host captures current versions and rejects stale references. Use a unique requestId; retry identical arguments with the same ID after an uncertain outcome. Returns runId: poll edit-diagram-status until completed, conflict or failed. Requires Workspace access.', inputSchema: z.toJSONSchema(editSchema) },
    { type: 'function', name: 'edit-diagram-status', description: 'Check a diagram edit started by this conversation. Completed means the browser applied the revision and persisted workspace history. For awaiting-acknowledgement, retry the original edit-diagram arguments and requestId.', inputSchema: z.toJSONSchema(runSchema) },
    { type: 'function', name: 'cancel-diagram-edit', description: 'Cancel a diagram edit from this conversation while it is generating. Application already in progress cannot be undone by cancellation; inspect the returned status.', inputSchema: z.toJSONSchema(runSchema) }
  ];
  private highlightRequests = new Map<string, { signature: string; prepared: Promise<{ input: Record<string, unknown>; documentId: string }> }>();
  private attachments = new Map<string, Promise<string>>();
  private requests = new Map<string, { signature: string; input: Promise<EditDiagramInput> }>();
  private owners = new Map<string, string>();
  constructor(private agent: Pick<AgentDiagrammingSessionService, 'call' | 'bridge'>) {}
  async call(name: string, raw: unknown, session: ChatToolSession) {
    if (name === 'highlight-node' || name === 'remove-highlights') return this.highlight(name, raw, session);
    if (name !== 'edit-diagram') {
      if (name !== 'edit-diagram-status' && name !== 'cancel-diagram-edit') throw Error('Unknown diagram tool');
      const input = runSchema.parse(raw);
      if (this.owners.get(input.runId) !== session.id) throw Error('This edit run does not belong to this conversation, or the backend was restarted.');
      return this.agent.call(name, input);
    }
    if (session.settings.sandbox === 'read-only') throw Error('Diagram editing requires Workspace access. Change Agent Chat access from Read only to Workspace.');
    const input = editSchema.parse(raw);
    if ((input.reference === undefined) === (input.nodeId === undefined)) throw Error('Specify either reference or nodeId.');
    const key = JSON.stringify([session.id, input.requestId]), signature = JSON.stringify(input);
    let request = this.requests.get(key);
    if (request && request.signature !== signature) throw Error('REQUEST_ID_CONFLICT: edit arguments differ');
    if (!request) {
      if (this.requests.size >= 500) throw Error('Chat edit capacity reached; restart the backend.');
      request = { signature, input: this.prepare(input, session).catch(error => { this.requests.delete(key); throw error; }) };
      this.requests.set(key, request);
    }
    const result = await this.agent.call('edit-diagram', await request.input) as DiagramEditRun;
    this.owners.set(result.runId, session.id);
    return result;
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
  private async prepare(input: z.infer<typeof editSchema>, session: ChatToolSession): Promise<EditDiagramInput> {
    const reference = input.reference === undefined ? undefined : session.canvasContext?.references[input.reference - 1];
    if (input.reference !== undefined && !reference) throw Error('Reference unavailable. Select the diagram or subtree and send it with your message.');
    const canvas = reference?.canvas ?? session.canvasContext?.canvas;
    if (!canvas) throw Error('Open a live canvas and send another message or use Read Canvas.');
    const nodeId = reference?.displayNodeId ?? input.nodeId!;
    const snapshot = await this.agent.bridge.dispatch(canvas.workspaceInstanceId, { method: 'snapshot', documentId: canvas.documentId }) as LiveDocumentSnapshot;
    const box = nodeId.startsWith('grid:') && findBox(snapshot.document.scene.root, nodeId.slice(5));
    const diagram = box && box.kind === 'diagram' ? snapshot.document.scene.contents[box.contentId] : undefined;
    if (!diagram) throw Error('The target diagram is no longer available. Read Canvas again.');
    if (reference && (reference.reference.diagramId !== diagram.diagramId || reference.reference.revisionId !== diagram.revisionId))
      throw Error('VERSION_CONFLICT: the referenced diagram changed. Reselect it and send the current reference.');
    let subtree: EditDiagramInput['subtree'];
    if (reference?.reference.kind === 'nodes') {
      const ids = new Set(reference.reference.nodeIds), nodes = diagramContentNodes(diagram.content);
      const roots = nodes.filter(node => ids.has(node.id) && (!node.parentId || !ids.has(node.parentId)));
      if (roots.length !== 1) throw Error('Select one complete subtree or the whole diagram to edit.');
      const range = diagramSubtreeRange(diagram, roots[0].id);
      const members = nodes.filter(node => node.line >= range.startLine && node.line <= range.endLine);
      if (members.length !== ids.size || members.some(node => !ids.has(node.id))) throw Error('Select one complete subtree without excluded nodes, or the whole diagram to edit.');
      subtree = { contentNodeId: roots[0].id, revisionId: diagram.content.revisionId };
    }
    return { sessionId: await this.attachment(canvas), expectedVersion: snapshot.version, nodeId, baseRevisionId: diagram.revisionId,
      prompt: input.prompt, requestId: randomUUID(), references: session.canvasContext?.references.map(value => value.reference), ...(subtree ? { subtree } : {}) };
  }
}
