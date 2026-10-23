import { rebaseDiagramHighlights } from './diagramHighlight';
import { buildDiagramContent } from './diagramContent';
import { diagramContentNodes } from './diagramContentNodes';
import { validateDiagram, type Diagram } from './diagram';

/** Replace whole, 1-based inclusive lines. Empty patch deletes the range. */
export function patchDiagram(before: Diagram, start: number, end: number, patch: string) {
  return patchDiagramRanges(before, [{ start, end, patch }]);
}

/** Apply nonoverlapping ranges from one base snapshot, parsing and issuing content only once. */
export function patchDiagramRanges(before: Diagram, input: readonly { start: number; end: number; patch: string | readonly string[] }[]) {
  const lines = before.content.ascii.split('\n');
  const patches = [...input].sort((a, b) => a.start - b.start).map(({ start, end, patch }, i, sorted) => {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > lines.length || i > 0 && start <= sorted[i - 1].end)
      throw Error('INVALID_PATCH_RANGE: use nonoverlapping existing 1-based inclusive lines');
    if (typeof patch !== 'string' && (!Array.isArray(patch) || patch.some(line => typeof line !== 'string' || /[\r\n]/.test(line)))) throw Error('Invalid patch lines');
    const normalized = typeof patch === 'string' ? patch.replace(/\r\n?/g, '\n') : patch.join('\n');
    if (normalized.length > 20000) throw Error('Invalid patch text');
    const inserted = typeof patch === 'string' ? normalized === '' ? [] : normalized.split('\n') : [...patch];
    return { start, end, inserted, unchanged: inserted.length === end - start + 1 && inserted.every((line, i) => line === lines[start - 1 + i]) };
  });
  const nextLines = [...lines];
  for (const { start, end, inserted } of [...patches].reverse()) nextLines.splice(start - 1, end - start + 1, ...inserted);
  const ascii = nextLines.join('\n'), unchanged = ascii === before.content.ascii;
  const lineAfter = (line: number): number | undefined => {
    let delta = 0;
    for (const patch of patches) {
      if (line < patch.start) break;
      if (line <= patch.end) return patch.unchanged ? line + delta : undefined;
      delta += patch.inserted.length - (patch.end - patch.start + 1);
    }
    return line + delta;
  };
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
