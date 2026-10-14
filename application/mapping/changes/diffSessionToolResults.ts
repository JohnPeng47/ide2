/** Workflow-only wire projection. The underlying canvas API and stored evidence stay complete. */
type ObjectValue = Record<string, any>;
const object = (value: unknown): value is ObjectValue => !!value && typeof value === 'object' && !Array.isArray(value);
function nodeSummary(node: ObjectValue) {
  return { id: node.id, version: node.version, layout: node.layout, kind: node.kind,
    title: node.content?.ascii?.split('\n')[0], revisionId: node.content?.revisionId };
}
function readNode(node: ObjectValue) {
  const source = node.diagram?.sourceContext;
  return { ...nodeSummary(node), childIds: node.childIds, geometry: node.geometry,
    ...(node.content ? { content: { ascii: node.content.ascii, revisionId: node.content.revisionId,
      structure: { kind: node.content.structure.kind, rootIds: node.content.structure.rootIds,
        nodes: Object.fromEntries(Object.entries(node.content.structure.nodes ?? {}).map(([id, raw]) => {
          const anchor = raw as ObjectValue;
          return [id, { id, label: anchor.label, line: anchor.line, parentId: anchor.parentId, childIds: anchor.childIds }];
        })) } } } : {}),
    ...(source ? { diagram: { id: node.diagram.id, diagramId: node.diagram.diagramId, revisionId: node.diagram.revisionId,
      sourceContext: { binding: source.binding, mappings: source.mappings,
        evidence: Object.fromEntries(Object.entries(source.evidence ?? {}).map(([id, raw]) => {
          const evidence = raw as ObjectValue;
          return [id, { id, label: evidence.label, category: evidence.category,
            sourceRanges: evidence.sourceRanges?.map(({ originalLines: _, ...range }: ObjectValue) => range) }];
        })), originalLinesOmitted: true } } } : {}) };
}
/** Keep explicitly selected values intact; only recognize complete API display-node envelopes. */
function readValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(readValue);
  if (!object(value)) return value;
  if (value.apiFormatVersion === 1 && value.layout === 'grid' && typeof value.id === 'string') return readNode(value);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, readValue(item)]));
}
export function compactDiffSessionToolResult(name: string, value: unknown): unknown {
  if (!object(value)) return readValue(value);
  if (name === 'exec') {
    const { transaction, ...rest } = value;
    return { ...readValue(rest) as ObjectValue, ...(transaction ? {
      transaction: { version: transaction.version, nodes: transaction.nodes?.map(nodeSummary),
        summary: true, detailHint: 'Read a specific diagram with nodes.get({nodeId}) when you need fresh anchors.' }
    } : {}) };
  }
  if (name === 'draw_diagram' || name === 'set_diagram_source_mappings') return {
    version: value.version, nodes: value.nodes?.map(nodeSummary), summary: true,
    detailHint: 'Read a specific diagram with nodes.get({nodeId}) when you need fresh anchors.'
  };
  return readValue(value);
}
