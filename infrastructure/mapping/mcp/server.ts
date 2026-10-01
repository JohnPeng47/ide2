import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { agentToolSchemas } from '../../../domain/mapping/agent/contracts';
export function createMappingMcpServer(baseUrl: string) {
  const base = new URL(baseUrl);
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Expected Mapping backend HTTP URL');
  const server = new McpServer({ name: 'mapping', version: '0.1.0' }, {
    instructions: 'Use diagram-search operation search/read for diagrams. canvas-api-search documents the API. Start with exec code "return canvas.list();", then canvas.attach, canvas.createDocument, or canvas.copyDocument. Create/copy in an unbound exec; copyDocument copies a live document into an independent unsaved draft. Pass the returned sessionId to later calls. exec methods are synchronous JavaScript; use return, not await. Mutations require expectedVersion and a unique requestId; retry the same requestId after transport failures. draw_diagram accepts finished ASCII and runs layout. save_diagram publishes a confirmed representation. Live editing requires an open Mapping page. Change-session editing runs on persisted backend copies and requires changeSessionId on every targeted call. save_diagram cannot publish previews. nodes.patchDiagram patches inclusive raw source lines. Session metadata uses update_diagram_change_session, outside the canvas/nodes/edges APIs.'
  });
  const descriptions = {
    'edit-diagram': 'Start an asynchronous prompt-driven edit of one live diagram. Requires sessionId, nodeId, current document expectedVersion, diagram.revisionId as baseRevisionId, prompt and requestId. Returns runId; poll edit-diagram-status. Applies one immutable child revision and one undo checkpoint, then flushes workspace persistence. Repeat the identical request to retry an awaiting-acknowledgement run; it never regenerates. Runs and retry receipts are in memory until backend restart.',
    'edit-diagram-status': 'Read a prompt-driven edit run, including progress, generated ASCII, result revision IDs, persistence acknowledgement, or conflict. Does not mutate diagrams.',
    'cancel-diagram-edit': 'Cancel a prompt-driven edit before application. Once applying or awaiting acknowledgement, cancellation does not undo or misreport a possibly committed edit; inspect its status or retry the original edit request.',
    set_diagram_source_mappings: 'Replace the complete source mappings and evidence on one diagram without resending ASCII. Requires its current content.asciiSha256 and document version. Preserves text, node anchors and connections. Live calls update the canvas and workspace history; changeSessionId targets an isolated proposal. Omitted source preserves the repository binding.',
    accept_diagram_change_session: 'Accept an entire ready proposal only when the user explicitly asks to accept it. Atomically publishes its changed canvases, freezes the session, and retains before/after revision and checkpoint references. Rejects stale originals. Retry the same requestId and expectedVersion after transport failures. Does not erase the review diff.',
    create_diagram_change_session: 'Capture saved canvases and current drafts as isolated proposal copies. Returns changeSessionId and canvasId. Pass changeSessionId to exec, diagram-search and draw_diagram for all proposal work. Does not modify or save original diagrams.',
    update_diagram_change_session: 'Session-specific metadata and history: annotate generated changes with titles, types 1/2/3/4, reasons and dependencies; mark ready or archive; undo/redo/reset a session document. Read session version and changes through diagram-search with changeSessionId. Ready requires valid anchors and connections for added diagrams. Does not accept or publish changes.',
    'diagram-search': 'Search diagrams by text, node, or code reference; operation read returns the complete saved or live diagram.',
    'canvas-api-search': 'Search API documentation, schemas, coordinate rules, and examples. Does not search canvas objects.',
    exec: 'Execute JavaScript using only canvas, nodes, and edges APIs. API calls are synchronous. Each mutation commits immediately with its own version and undo entry. Later calls see earlier edits; failures leave successful edits in place. Retry transport failures with the same requestId.',
    draw_diagram: 'Create or replace a diagram from complete ASCII content. No reserved bounds; existing grid layout places the result.',
    save_diagram: 'Save a live diagram/document as a confirmed representation visible in explorer and search. nodeId saves one diagram independently.'
  };
  for (const name of Object.keys(agentToolSchemas) as (keyof typeof agentToolSchemas)[]) {
    server.registerTool(name, { description: descriptions[name], inputSchema: agentToolSchemas[name], annotations: { readOnlyHint: name.endsWith('search') || name === 'edit-diagram-status', openWorldHint: false } }, async (input: unknown) => {
      try {
        const response = await fetch(new URL(`/api/mapping/agent/tools/${name}`, base), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(65000) });
        const value = await response.json();
        return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], ...(response.ok ? { structuredContent: { result: value } } : { isError: true }) };
      } catch (error) { return { content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }], isError: true }; }
    });
  }
  return server;
}
export async function startMappingMcpServer(baseUrl: string) { await createMappingMcpServer(baseUrl).connect(new StdioServerTransport()); }
