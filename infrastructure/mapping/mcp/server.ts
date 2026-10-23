import { generationSchemas, generationBatchSchemas, directBatchSchemas, directDiagramInstructions, isDiagramTool } from '../../../domain/mapping/agent/diagramBatch';
import { diagramOutputFormat } from '../../../domain/mapping/agent/promptTemplates';
import { CANVAS_EXEC_DESCRIPTION, canvasAgentInstructions } from '../../../domain/mapping/agent/capabilities';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { agentToolSchemas } from '../../../domain/mapping/agent/contracts';
export function createMappingMcpServer(baseUrl: string, binding = process.env.MAPPING_CHAT_BINDING,
  target?: { canvasId: string; documentId: string }) {
  const base = new URL(baseUrl);
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Expected Mapping backend HTTP URL');
  let attachment: Promise<string> | undefined;
  const post = async (name: string, input: unknown) => {
    const response = await fetch(new URL(`/api/mapping/agent/tools/${name}`, base), { method: 'POST',
      headers: { 'content-type': 'application/json', ...(binding ? { 'x-canvas-chat-binding': binding } : {}) },
      body: JSON.stringify(input), signal: AbortSignal.timeout(65000) });
    return { response, value: await response.json() };
  };
  const attachedSession = () => attachment ??= post('exec', { requestId: crypto.randomUUID(), code: `return canvas.attach(${JSON.stringify(target)});` })
    .then(({ response, value }) => { if (!response.ok) throw Error(value.error ?? 'Canvas attachment failed'); return value.value.sessionId as string; })
    .catch(error => { attachment = undefined; throw error; });
  const server = new McpServer({ name: 'mapping', version: '0.1.0' }, {
    instructions: (binding || target
      ? 'This persistent connection is bound to a canvas. Start with exec code return canvas.read({}); omit sessionId. Agent Chat captures the document for each turn. Do not attach elsewhere or start another MCP client. '
      : 'Use this connected MCP server directly. Call exec with return canvas.list(); then canvas.attach and pass its sessionId on later calls. Configure --canvas and --document at server startup to bind automatically. ')
      + 'Common method definitions are included in exec; use canvas-api-search only for additional APIs. ChangeSession operations require changeSessionId. Each new request needs a unique requestId. Retry uncertain outcomes with identical arguments and requestId. '
  });
  const descriptions = {
    get_repository_diff_hunks: 'Discover immutable Git hunks for repositoryId and selected commits before creating a ChangeSession. Returns pinned full commit SHAs, head, and stable hunk IDs. Each commit compares with its first parent (root commits with empty tree); renames are delete/add. Paginated; reuse returned SHAs on later pages and creation. includePatches false returns metadata only.',
    read_change_session_diff_tree: 'Read a ChangeSession DiffTree Diagram, stable logical nodes and mappings, plus paginated captured hunks. nodeIds resolves selected tree nodes with ancestor fallback; hunkIds selects hunks directly. Uses persisted content without rereading Git or loading canvas histories. Legacy sessions return diffTree null.',

    list_repositories: 'List registered repositories, stable IDs, names and available checkout roots. Worktrees share one repository identity.',
    register_repository: 'Register a local Git repository/worktree in this project. The same Git common directory resolves to the same repository ID. Does not move canvases or change Git history.',
    'diagram-agent-context': 'Prepare, read, or delete a reusable AgentContext bound to a live diagram. Read loads the disk-backed context and returns ready/stale status. Prepare compiles source evidence into a dedicated immutable file; delete removes the binding. Prepare/delete require expectedVersion and expectedRevisionId from a current canvas read, are undoable and persisted. Retry mutations with the same requestId.',
    'canvas-view': 'Record and restore named views of this live canvas. operation: start (requires name), stop (save recording), cancel (discard recording metadata, keep edits), list, read (requires viewId), apply (requires viewId), delete (requires viewId). Recording captures committed canvas edits, diagram revisions, variants and undo/redo. Apply restores the complete saved state as one undoable change; it does not merge edits or rerun LLM calls. Stop recording before applying. Mutations require current expectedVersion and a unique requestId; retry identical arguments after uncertain outcomes. Views are persisted with the canvas. Cross-canvas transfer results are captured locally; applying a view does not move objects in other canvases.',
    'edit-diagram': 'Start an asynchronous prompt-driven edit of one live diagram. Requires sessionId, nodeId, current document expectedVersion, diagram.revisionId as baseRevisionId, prompt and requestId. Optional agentContextId uses a trajectory uploaded over the connected-agent WebSocket for this workspace/document. Returns runId; poll edit-diagram-status. Required edit-mode: in-place applies one immutable child revision; variant saves the edit in a new variant without changing the live diagram. Required replace-mode (no default): diagram (omit subtree targets), subnode-single (supply subtree {contentNodeId, revisionId}), multi-contiguous (supply subtrees: at least two adjacent roots), or multi-disjoint (supply subtrees: at least two separate roots). Target revisionId is content.revisionId; use current parsed content node IDs. Each target includes its descendants. Overlaps, stale targets, and edits outside the selected ranges are rejected. Both edit modes create one undo checkpoint and flush workspace persistence. Repeat the identical request to retry an awaiting-acknowledgement run; it never regenerates. Runs and retry receipts are in memory until backend restart. Optional template and references work as in create-diagram.',
    'extend-diagram': 'Create a connected diagram at the chosen canvas origin from selected source nodes.',
  'create-diagram': 'Start an asynchronous prompt-driven creation of 1–4 new diagrams beside one live anchor diagram. Uses target, prompt, context and reference fields plus optional count; omit edit-mode, replace-mode, and subtree targets; nodeId and baseRevisionId pin the anchor whose revision and evidence are the context. Optional template {id, version, options, markdown?} and references (diagram or node ranges pinned to revisionIds, cited in the prompt as [ref N]). Poll edit-diagram-status; created.nodeIds lists the placed diagrams. Repeat the identical request to retry; it never regenerates.',
    'edit-diagram-status': 'Read a prompt-driven edit run, including progress, generated ASCII, result revision IDs, persistence acknowledgement, or conflict. Does not mutate diagrams.',
    'cancel-diagram-edit': 'Cancel a prompt-driven edit before application. Once applying or awaiting acknowledgement, cancellation does not undo or misreport a possibly committed edit; inspect its status or retry the original edit request.',
    set_diagram_source_mappings: 'Replace the complete source mappings and evidence on one diagram without resending ASCII. Requires the current document version; content validation is internal. Preserves text, node anchors and connections. Live calls update the canvas and workspace history; changeSessionId targets an isolated proposal. Omitted source preserves the repository binding.',
    accept_diagram_change_session: 'Accept an entire ready proposal only when the user explicitly asks to accept it. Atomically publishes its changed canvases, freezes the session, and retains before/after revision and checkpoint references. Rejects stale originals. Retry the same requestId and expectedVersion after transport failures. Does not erase the review diff.',
    create_diagram_change_session: 'Capture canvases owned by repositoryId as isolated proposal copies. Specify repositoryId when multiple repositories are registered. commits is an explicit set of commit refs (default empty); head defaults to the selected repository HEAD. Both are resolved to full SHAs and pinned at creation. Optional diffTree supplies ASCII and line/node-to-hunk mappings atomically; otherwise creates a default tree. Returns changeSessionId and canvasId. Pass changeSessionId to exec, diagram-search and draw_diagram for all proposal work. Does not modify or save original diagrams.',
    update_diagram_change_session: 'Session-specific metadata and history: diffTree replaces the complete hunk mapping list and optionally tree ASCII; existing trees require diffTree.expectedRevisionId plus session expectedVersion. Omission preserves DiffTree. Annotate generated changes with titles, types 1/2/3/4, reasons and dependencies; replace migrations with explicit source/destination revision-bound node or subtree endpoints (destination snapshot must be proposed); omitted migrations preserves them, [] clears them; mark ready or archive; undo/redo/reset a session document. Read session version and changes through diagram-search with changeSessionId. Ready requires valid anchors and connections for added diagrams. Does not accept or publish changes.',
    'diagram-search': 'Search diagrams by text, node, or code reference; operation read returns the complete saved or live diagram. With changeSessionId and no sessionId, snapshot baseline/proposed selects captured/proposed content (default proposed); representationId selects the session document. Returns migration metadata alongside generated changes.',
    'canvas-api-search': 'Search API documentation, schemas, coordinate rules, and examples. Does not search canvas objects.',
    exec: binding ? CANVAS_EXEC_DESCRIPTION : canvasAgentInstructions('edit'),
    draw_diagram: 'Create or replace a diagram from complete ASCII content. No reserved bounds; existing grid layout places the result.',
    save_diagram: 'Save a live diagram/document as a confirmed representation visible in explorer and search. nodeId saves one diagram independently.'
  };
  for (const name of Object.keys(agentToolSchemas) as (keyof typeof agentToolSchemas)[]) {
    // MCP requires an object at the schema root. Validate the exclusive single/batch
    // contract after resolving the connection's session, below.
    const single = isDiagramTool(name) ? generationSchemas[name] : undefined;
    const schema = binding && isDiagramTool(name) ? directBatchSchemas[name]
      : single && isDiagramTool(name) ? single.partial().extend({ sessionId: single.shape.sessionId,
        expectedVersion: single.shape.expectedVersion, requestId: single.shape.requestId,
        operations: generationBatchSchemas[name].shape.operations.optional() }).strict()
      : agentToolSchemas[name];
    const optionalSession = (schema: z.ZodType): z.ZodType => schema instanceof z.ZodUnion
      ? z.union(schema.options.map(option => optionalSession(option as z.ZodType)))
      : schema instanceof z.ZodObject && 'sessionId' in schema.shape ? schema.extend({ sessionId: z.string().optional() }) : schema;
    const description = binding && isDiagramTool(name)
      ? directDiagramInstructions(name) + diagramOutputFormat(name, 'optional', `${name} using operations[].${name === 'edit-diagram' ? 'edit' : 'diagram'}`)
      : descriptions[name] + (isDiagramTool(name) ? ' Also accepts {sessionId, expectedVersion, requestId, operations:[...]} for an atomic batch. Operations share the base snapshot; generation completes before one persisted undo step. source-mappings is optional and defaults to false.' : '');
    server.registerTool(name, { description, inputSchema: binding || target ? optionalSession(schema) : schema, annotations: { readOnlyHint: name.endsWith('search') || name === 'edit-diagram-status' || name === 'get_repository_diff_hunks' || name === 'read_change_session_diff_tree' || name === 'list_repositories', openWorldHint: false } }, async (input: unknown) => {
      try {
        const args = { ...(input as Record<string, unknown>) };
        if (target && !binding && !args.changeSessionId) {
          const scoped = ['exec', 'draw_diagram', 'save_diagram', 'set_diagram_source_mappings', 'edit-diagram', 'create-diagram', 'extend-diagram', 'diagram-agent-context', 'canvas-view', 'diagram-search'];
          if (scoped.includes(name) && !(name === 'diagram-search' && args.representationId)) {
            const sessionId = await attachedSession();
            if (args.sessionId && args.sessionId !== sessionId) throw Error('BINDING_MISMATCH: omit sessionId on a bound connection');
            args.sessionId = sessionId;
          }
        }
        if (!binding && isDiagramTool(name)) agentToolSchemas[name].parse(args);
        const { response, value } = await post(name, args);
        return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], ...(response.ok ? { structuredContent: { result: value } } : { isError: true }) };
      } catch (error) { return { content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }], isError: true }; }
    });
  }
  return server;
}
export async function startMappingMcpServer(baseUrl: string, target?: { canvasId: string; documentId: string }) { await createMappingMcpServer(baseUrl, undefined, target).connect(new StdioServerTransport()); }
