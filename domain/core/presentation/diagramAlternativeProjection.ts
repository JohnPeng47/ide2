import { scopeOwner, type DiagramAlternativePart } from './diagramAlternative';
import { revisionScope } from '../diagrams/diagramRevisionReview';
import type { DiagramRevision } from '../diagrams/diagramRevision';
import { compareDiagramRevisions } from '../diagrams/diagramDiff';
import { analyzeDiagramSyntax } from '../diagrams/diagramSyntaxAnalysis';
import { diagramTextRanges } from './diagramText';
import { projectDiagramDiffRows } from './diagramDiffProjection';
import { presentationHighlights, type DiagramPresentationSettings } from './diagramPresentation';

/** A panel borrows pinned source content, including syntax, evidence and annotations. */
export function projectAlternativePart(part: DiagramAlternativePart, displayNodeId: string, display: 'regular' | 'diff',
  get: (id: string) => DiagramRevision, settings?: DiagramPresentationSettings) {
  const source = get(part.source.revisionId), base = get(part.baseRevisionId);
  const scope = revisionScope(source, scopeOwner(part.source.scope)), previousScope = revisionScope(base, scopeOwner(part.target));
  const ranges = (revision: DiagramRevision) => diagramTextRanges({ revisionId: revision.id, content: revision.diagram.content,
    ascii: revision.diagram.content.ascii, displayNodeId, sourceContext: revision.diagram.sourceContext, mappings: revision.diagram.sourceContext.mappings,
    syntax: analyzeDiagramSyntax(revision.diagram, settings?.markerRules), presentation: settings,
    highlights: presentationHighlights(revision.diagram, settings, revision.nodeRefs) });
  const diff = compareDiagramRevisions(base, source);
  const rows = projectDiagramDiffRows({ content: source.diagram.content, ranges: ranges(source),
    sourceLines: Array.from({ length: scope.endLine - scope.startLine + 1 }, (_, i) => scope.startLine + i),
    diff: { ...diff, removals: diff.removals.filter(row => row.sourceLine !== undefined && row.sourceLine >= previousScope.startLine && row.sourceLine <= previousScope.endLine) },
    enabled: display === 'diff', previous: base.diagram, previousRanges: ranges(base) }).rows;
  return rows.map(row => ({ ...row, runs: row.runs.map(run => {
    if (display !== 'diff') return run;
    const status = run.diffVersion === 'previous' || run.diffStatus === 'removed' ? 'removed'
      : run.diffVersion === 'current' ? 'added' : run.owner?.contentNodeId ? diff.proposed.nodes.get(run.owner.contentNodeId)?.status : row.sourceLine ? diff.proposed.lines.get(row.sourceLine) : undefined;
    return status === 'added' || status === 'removed' ? { ...run, decoration: { ...run.decoration,
      backgroundColor: status === 'added' ? 'var(--diff-added-fill)' : 'var(--diff-deleted-fill)', color: status === 'added' ? 'var(--diff-added-text)' : 'var(--diff-deleted-text)' } } : run;
  }) }));
}
