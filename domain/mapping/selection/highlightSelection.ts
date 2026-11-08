import { diagramContentNodes } from '../../core/diagrams/diagramContentNodes';
import { contentNodeIntersectsRect, contentNodeSpans } from '../../core/diagrams/contentNodeGeometry';
import { activeDiagramHighlights, highlightNodeIds, sameHighlightTargets } from '../../core/diagrams/diagramHighlight';
import { connectionBox } from '../../core/diagrams/diagramConnection';
import { getDiagramRevision } from '../../core/diagrams/diagramRevisionStore';
import { presentationHighlights } from '../../core/presentation/diagramPresentation';
import type { MappingGridDocument } from '../workspace/mappingGrid';
import type { DiagramOperation } from '../workspace/mappingDocumentController';
import { selectionContentNodes, type SelectionItem } from './selectionState';

/** Use captured node membership; unstructured text selections retain their exact rectangle. */
export function highlightSelection(document: MappingGridDocument, items: readonly SelectionItem[]): DiagramOperation[] {
  return items.flatMap((item): DiagramOperation[] => {
    const box = connectionBox(document.scene, item.displayNodeId);
    if (box?.kind !== 'diagram') throw Error('The selected diagram is no longer available.');
    const diagram = document.scene.contents[box.contentId], region = item.region;
    const current = presentationHighlights(diagram, document.diagramPresentations?.[box.contentId], getDiagramRevision(diagram.revisionId).nodeRefs);
    const highlightNodes = (ids?: string[]): DiagramOperation[] => {
      const targets = ids ? { contentNodeIds: ids } : {};
      if (current.some(h => !h.textRange && h.color === 'yellow' && sameHighlightTargets(h, targets))) return [];
      return [{ method: 'highlight', nodeId: item.displayNodeId, ...targets, highlightId: crypto.randomUUID() }];
    };
    if (!region) return highlightNodes();
    if (region.sourceContentId !== diagram.id || region.sourceAscii !== diagram.content.ascii)
      throw Error('The selected text changed. Select it again to highlight it.');
    const ids = selectionContentNodes(diagram, region).map(node => node.id);
    if (ids.length) return highlightNodes(ids);
    const highlights = [...current];
    const lines = diagram.content.ascii.split('\n');
    const rect = region.rect;
    let added = false;
    for (let line = rect.startLine; line <= Math.min(rect.endLine, lines.length); line++) {
      const startColumn = Math.max(1, rect.startColumn), endColumn = Math.min(rect.endColumn, lines[line - 1].length);
      if (endColumn < startColumn) continue;
      const textRange = { startLine: line, endLine: line, startColumn, endColumn };
      if (highlights.some(h => h.revisionId === diagram.revisionId && JSON.stringify(h.textRange) === JSON.stringify(textRange))) continue;
      highlights.push({ id: crypto.randomUUID(), color: 'yellow', revisionId: diagram.revisionId, textRange }); added = true;
    }
    return added ? [{ method: 'setPresentation', nodeId: item.displayNodeId, settings: { highlights } }] : [];
  });
}

/** Match any active annotation touched by the selection, regardless of its color or target grouping. */
function selectedHighlights(document: MappingGridDocument, items: readonly SelectionItem[]) {
  return items.flatMap(item => {
    const box = connectionBox(document.scene, item.displayNodeId);
    if (box?.kind !== 'diagram') return [];
    const diagram = document.scene.contents[box.contentId], region = item.region;
    if (region && (region.sourceContentId !== diagram.id || region.sourceAscii !== diagram.content.ascii)) return [];
    const nodes = region ? selectionContentNodes(diagram, region) : [];
    const ids = new Set((region && !nodes.length ? diagramContentNodes(diagram.content).filter(node => contentNodeIntersectsRect(node, region.rect)) : nodes).map(node => node.id));
    const spans = nodes.flatMap(node => [...contentNodeSpans(node)]);
    const highlights = activeDiagramHighlights(diagram.content,
      presentationHighlights(diagram, document.diagramPresentations?.[box.contentId], getDiagramRevision(diagram.revisionId).nodeRefs), diagram.revisionId);
    return highlights.flatMap(highlight => {
      const targets = highlightNodeIds(highlight), range = highlight.textRange;
      const intersects = !region || (!targets.length && !range) || targets.some(id => ids.has(id))
        || !!range && (spans.length ? spans : Array.from({ length: region.rect.endLine - region.rect.startLine + 1 }, (_, i) => ({
          line: region.rect.startLine + i, startColumn: region.rect.startColumn, endColumn: region.rect.endColumn
        }))).some(span => span.line >= range.startLine && span.line <= range.endLine
          && span.endColumn >= (span.line === range.startLine ? range.startColumn : 1)
          && span.startColumn <= (span.line === range.endLine ? range.endColumn : Infinity));
      return intersects ? [{ nodeId: item.displayNodeId, contentId: box.contentId, highlight,
        remaining: region && targets.length ? targets.filter(id => !ids.has(id)) : [] }] : [];
    });
  });
}

export function selectionHasHighlights(document: MappingGridDocument, items: readonly SelectionItem[]): boolean {
  return selectedHighlights(document, items).length > 0;
}

export function unhighlightSelection(document: MappingGridDocument, items: readonly SelectionItem[]): DiagramOperation[] {
  // Multiple selected instances can share content. Merge removals before issuing one edit per annotation.
  const matches = new Map<string, ReturnType<typeof selectedHighlights>[number]>();
  for (const match of selectedHighlights(document, items)) {
    const key = JSON.stringify([match.contentId, match.highlight.id]), previous = matches.get(key);
    matches.set(key, previous ? { ...match, remaining: match.remaining.filter(id => previous.remaining.includes(id)) } : match);
  }
  return [...matches.values()].flatMap(({ nodeId, highlight, remaining }): DiagramOperation[] => [
    { method: 'removeHighlights', nodeId, highlightIds: [highlight.id] },
    ...(remaining.length ? [{ method: 'highlight' as const, nodeId, highlightId: highlight.id, color: highlight.color, contentNodeIds: remaining }] : [])
  ]);
}
