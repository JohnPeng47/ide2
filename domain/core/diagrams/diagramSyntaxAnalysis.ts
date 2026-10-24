import type { Diagram } from './diagram';
import { diagramSyntaxLine, mappedDiagramSyntax, type DiagramSyntaxRange } from './diagramSyntax';
import { diagramMarkerRulesSchema, diagramMarkerSpans, type DiagramMarkerRule, type DiagramMarkerSpan } from './diagramMarkers';

export interface DiagramLineSyntax { lexical: readonly DiagramSyntaxRange[]; semantic: readonly DiagramSyntaxRange[]; markers: readonly DiagramMarkerSpan[] }
const cache = new WeakMap<Diagram, { rulesKey: string; lines: ReadonlyMap<number, DiagramLineSyntax> }>();
/** Derived domain classifications; no style, geometry, or display identity enters the cache. */
export function analyzeDiagramSyntax(diagram: Diagram, rules: readonly DiagramMarkerRule[] = []): ReadonlyMap<number, DiagramLineSyntax> {
  const rulesKey = JSON.stringify(rules), cached = cache.get(diagram);
  if (cached?.rulesKey === rulesKey) return cached.lines;
  const validated = diagramMarkerRulesSchema.parse(rules);
  const lines = new Map<number, DiagramLineSyntax>();
  const source = diagram.sourceContext.contentHash === diagram.content.asciiSha256 ? diagram.sourceContext : undefined;
  diagram.content.ascii.split('\n').forEach((text, index) => {
    const lexical = diagramSyntaxLine(text, diagram.diagramId);
    lines.set(index + 1, { lexical, semantic: source ? mappedDiagramSyntax(text, index + 1, source, lexical) : [], markers: diagramMarkerSpans(text, validated) });
  });
  cache.set(diagram, { rulesKey, lines });
  return lines;
}
