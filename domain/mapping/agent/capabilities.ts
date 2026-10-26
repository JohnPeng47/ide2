import { canvasMethods } from './contracts';
import { z } from 'zod';

const readActions = ['canvas.read', 'nodes.get', 'nodes.list', 'nodes.variants', 'nodes.alternatives', 'edges.list'] as const;
const editActions = ['nodes.promoteAlternative', 'nodes.selectAlternative', 'nodes.removeAlternative', 'nodes.sidePanel', 'nodes.reviewVariant', 'nodes.selectRevision', 'nodes.setPresentation', 'nodes.highlight', 'nodes.removeHighlights', 'nodes.draw', 'nodes.replace', 'nodes.move', 'nodes.patchDiagram', 'nodes.collapse', 'edges.create', 'edges.update', 'edges.remove'] as const;
export const CANVAS_EXEC_DESCRIPTION = `Execute synchronous JavaScript with canvas, nodes and edges; use return, not await. Use the connected MCP tool directly, without creating a shell MCP client or rediscovering these common methods.
Consecutive mutations batch by default: one browser command, one version increment and one undo entry per batch. A read, nodes.setSourceMappings or nodes.setJumps flushes preceding edits. Successful script completion flushes the final batch. An uncaught script error discards pending edits. A rejected batch applies none of its operations; earlier flushed batches remain committed.
Mutations require expectedVersion from a current read and a unique requestId. Retry an uncertain transport outcome with exactly the same arguments and requestId. In-script mutation calls return queued handles {id, nodeId} or {id, edgeId}, not full nodes. Use a read if subsequent code needs committed data. The tool response is {value, transaction:{version, receipts:[{method,nodeId?,edgeId?,status,highlightId?,color?,markdownUrl?}]}}. Receipts describe each batch at commit time; later edits can supersede them. Use contentNodeIds to save one highlight spanning multiple nodes in the same diagram, with one color, saved ID and link. Highlight receipts contain the actual saved ID and ready-to-use markdownUrl. Use those links verbatim. Return only the fields you need from reads.
Set mode: "immediate" only for legacy scripts requiring full per-edit results and separate commits. It returns the original full-node transaction format.
Example read: const r = canvas.read({level:"small"}); return {version:r.version, targets:r.nodes.map(n => ({nodeId:n.id, anchors:Object.values(n.content?.structure.nodes ?? {}).map(a => ({id:a.id,label:a.label}))}))};
Example batch (with current IDs and expectedVersion): for (const target of targets) nodes.highlight({...target,color:"blue"});
Read results contain version and nodes; diagram ASCII is content.ascii and anchors are content.structure.nodes. Use returned IDs verbatim. Additional methods remain available through canvas-api-search.`;

export function canvasCapabilities(mode: 'read' | 'edit') {
  return [...readActions, ...(mode === 'edit' ? editActions : [])].map(name => ({ name,
    description: canvasMethods[name].description, inputSchema: z.toJSONSchema(canvasMethods[name].schema) }));
}
export function canvasAgentInstructions(mode: 'read' | 'edit') {
  return `${CANVAS_EXEC_DESCRIPTION}\nCanvas capabilities (${mode}):\n${JSON.stringify(canvasCapabilities(mode))}`;
}
