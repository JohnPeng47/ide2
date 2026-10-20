import { rebaseDiagramHighlights } from './diagramHighlight';
import { buildDiagramContent } from './diagramContent';
import { diagramContentNodes } from './diagramContentNodes';
import { validateDiagram, type Diagram } from './diagram';

/** Replace whole, 1-based inclusive lines. Empty patch deletes the range. */
export function patchDiagram(before: Diagram, start: number, end: number, patch: string) {
  const lines = before.content.ascii.split('\n');
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > lines.length) {
    throw new Error('INVALID_PATCH_RANGE: use existing 1-based inclusive lines');
  }
  if (typeof patch !== 'string' || patch.length > 20000) throw new Error('Invalid patch text');
  const normalized = patch.replace(/\r\n?/g, '\n');
  const inserted = normalized === '' ? [] : normalized.split('\n');
  const ascii = [...lines.slice(0, start - 1), ...inserted, ...lines.slice(end)].join('\n');
  const unchanged = ascii === before.content.ascii;
  const lineAfter = (line: number): number | undefined => unchanged || line < start ? line
    : line > end ? line + inserted.length - (end - start + 1) : undefined;
  const content = unchanged ? before.content : buildDiagramContent(ascii, `${before.id}:${before.revision + 1}`,
    before.content.structure.kind, before.content.structure.kind === 'tree' ? before.content.structure.parserVersion : undefined);
  const afterNodes = diagramContentNodes(content);
  const nodeIds = new Map<string, string>();
  for (const node of diagramContentNodes(before.content)) {
    const line = lineAfter(node.line);
    const matches = afterNodes.filter(n => n.line === line && n.startColumn === node.startColumn
      && n.endColumn === node.endColumn && n.label === node.label);
    if (matches.length === 1) nodeIds.set(node.id, matches[0].id);
  }
  const diagram: Diagram = unchanged ? before : {
    ...before, revision: before.revision + 1, content,
    ...(before.highlights ? { highlights: rebaseDiagramHighlights(before.highlights, nodeIds) } : {}),
    sourceContext: { ...before.sourceContext, contentHash: content.asciiSha256,
      mappings: before.sourceContext.mappings.flatMap(mapping => {
        const line = lineAfter(mapping.line);
        return line === undefined ? [] : [{ ...mapping, line }];
      }) },
    ...(before.jumps ? { jumps: before.jumps.map(jump => {
      const source = jump.source, line = lineAfter(source.line);
      if (line === undefined || source.revisionId !== before.content.revisionId || source.contentHash !== before.content.asciiSha256
        || source.contentNodeId && !nodeIds.has(source.contentNodeId)) return jump;
      return { ...jump, source: { ...source, line, revisionId: content.revisionId, contentHash: content.asciiSha256,
        ...(source.contentNodeId ? { contentNodeId: nodeIds.get(source.contentNodeId)! } : {}) } };
    }) } : {})
  };
  validateDiagram(diagram);
  return { diagram, lineAfter, nodeIds };
}
