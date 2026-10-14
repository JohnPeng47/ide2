import { z } from 'zod';
import { canvasDisplayNodes } from '../../../domain/mapping/workspace/canvasDisplayNode';
import { agentToolSchemas, canvasApiSpec, type AgentToolName } from '../../../domain/mapping/agent/contracts';
import { diffTreeInputSchema } from '../../../domain/mapping/changes/diffTree';
import { CanvasApiProjection } from '../agent/apiProjection';
import type { AgentDiagrammingSessionService } from '../agent/sessionService';
import type { ChangeSessionCapture, ChangeSessionService } from './changeSessionService';
import type { DiffSessionStep, DiffSessionTool } from './diffSessionWorkflow';

const sourceSchema = z.object({ path: z.string().min(1), revision: z.string().optional(), startLine: z.number().int().positive().default(1), limit: z.number().int().min(1).max(400).default(200) }).strict();
export interface DiffSessionSourceReader { (input: z.infer<typeof sourceSchema>): Promise<unknown> }

/** Stage and target restrictions are enforced here, independently of model instructions. */
export class DiffSessionTools {
  private readonly projection = new CanvasApiProjection();
  changeSessionId?: string;
  constructor(private readonly capture: ChangeSessionCapture, private readonly changes: ChangeSessionService,
    private readonly agent: AgentDiagrammingSessionService, private readonly readSource: DiffSessionSourceReader,
    private readonly requestId: string, private readonly title: string,
    private readonly onCreated: (id: string) => Promise<void>) {}

  private tool(name: string, description: string, schema: z.ZodType, execute: (input: any) => Promise<unknown>): DiffSessionTool {
    return { name, description, schema: z.toJSONSchema(schema), execute: raw => execute(schema.parse(raw)) };
  }
  private frozenSearch(input: z.infer<typeof agentToolSchemas['diagram-search']>) {
    const documents = this.capture.documents.filter(doc => !input.representationId || input.representationId === doc.id);
    const nodes = documents.flatMap(doc => canvasDisplayNodes(doc.baseline!.document, doc.baseline!.canvas, 0)
      .filter(node => node.layout === 'grid' && node.kind === 'diagram')
      .map(node => ({ documentId: doc.id, name: doc.name, node: this.projection.node(node) })));
    if (input.operation === 'read') {
      if (documents.length !== 1) throw Error('Specify representationId from the pinned document list');
      const selected = nodes.filter(entry => !input.nodeId || entry.node.id === input.nodeId);
      return { version: 0, nodes: selected, edges: documents[0].baseline!.document.edges };
    }
    const query = (input.query ?? '').toLowerCase();
    const hits = nodes.filter(entry => entry.node.layout === 'grid' && JSON.stringify(entry.node.content).toLowerCase().includes(query))
      .map(entry => ({ representationId: entry.documentId, name: entry.name, nodeId: entry.node.id,
        snippet: entry.node.layout === 'grid' ? entry.node.content?.ascii.split('\n').slice(0, 3).join('\n') : '' }));
    return { total: hits.length, hits: hits.slice(input.offset, input.offset + input.limit) };
  }
  tools(step: DiffSessionStep): DiffSessionTool[] {
    const read = [
      this.tool('canvas-api-search', 'Discover short canvas API methods and schemas.', agentToolSchemas['canvas-api-search'], async input => canvasApiSpec(input.query)),
      this.tool('diagram-search', 'Read/search frozen baseline diagrams during analysis. Specify representationId and optionally nodeId to read one diagram. During materialization reads the new proposal; snapshot baseline reads its originals.', agentToolSchemas['diagram-search'], async input => {
        if (step === 'analyze' || !this.changeSessionId) return this.frozenSearch(input);
        const result = await this.agent.call('diagram-search', this.bound(input)) as any;
        if (input.nodeId && Array.isArray(result.nodes)) result.nodes = result.nodes.filter((node: any) => node.id === input.nodeId);
        return result;
      }),
      this.tool('get_repository_diff_hunks', 'Read the immutable hunks captured for this workflow; commits/head cannot change.', agentToolSchemas.get_repository_diff_hunks, async input => {
        const hunks = this.capture.hunks.slice(input.offset, input.offset + input.limit);
        return { ...this.capture.context, total: this.capture.hunks.length,
          nextOffset: input.offset + input.limit < this.capture.hunks.length ? input.offset + input.limit : null,
          hunks: input.includePatches ? hunks : hunks.map(({ patch: _, ...metadata }) => metadata) };
      }),
      this.tool('read_repository_source', 'Read a source file at pinned head (default), a selected commit or a captured hunk parent. Returns numbered source lines; never reads the working tree.', sourceSchema, this.readSource)
    ];
    if (step === 'analyze') return read;
    return [...read,
      this.tool('create_diagram_change_session', 'Create this run\'s one isolated proposal from its frozen baseline and pinned hunks. Safe to repeat with identical arguments.',
        z.object({ diffTree: diffTreeInputSchema.optional(), description: z.string().max(100000).optional() }).strict(), async input => {
          const result = await this.changes.create({ title: this.title, requestId: this.requestId, ...input }, this.capture) as { changeSessionId: string };
          this.changeSessionId = result.changeSessionId;
          await this.onCreated(result.changeSessionId);
          return result;
        }),
      ...(['exec', 'draw_diagram', 'set_diagram_source_mappings', 'update_diagram_change_session', 'read_change_session_diff_tree'] as const).map(name =>
        this.tool(name, name === 'exec' ? 'Execute synchronous short canvas API JavaScript on this proposal. Return results. Attach using canvas.attach; use current document expectedVersion for mutations.'
          : `Call ${name} on this workflow's proposal using the current version and a new requestId for each new mutation.`, agentToolSchemas[name],
        async input => this.agent.call(name as AgentToolName, this.bound(input)))),
      this.tool('complete_diff_session', 'Validate the ready proposal and complete this workflow. Repair errors before retrying.', z.object({}).strict(), async () => {
        if (!this.changeSessionId) throw Error('Create the proposal first');
        const session = await this.changes.get(this.changeSessionId);
        if (session.status !== 'ready' || !session.changes.length) throw Error('Implement changes and mark the proposal ready first');
        const mapped = new Set(session.diffTree?.mappings.flatMap(mapping => mapping.targets.map(target => target.hunkId)));
        const missing = this.capture.hunks.filter(hunk => !mapped.has(hunk.id));
        if (missing.length) throw Error(`DiffTree is missing ${missing.length} hunks: ${missing.map(hunk => hunk.id).join(', ')}`);
        return { changeSessionId: session.id, status: session.status, changes: session.changes.length,
          documents: session.documents.map(doc => ({ id: doc.id, name: doc.name })) };
      })
    ];
  }
  private bound(input: Record<string, unknown>) {
    if (!this.changeSessionId) throw Error('Create this workflow\'s proposal first');
    if (input.changeSessionId && input.changeSessionId !== this.changeSessionId) throw Error('Workflow cannot access another ChangeSession');
    return { ...input, changeSessionId: this.changeSessionId };
  }
}
