import type { DiagramRevision } from '../diagrams/diagramRevision';
import { resolveRevisionLines, type RevisionSelections } from '../diagrams/diagramRevisionSelection';
import { analyzeDiagramSyntax } from '../diagrams/diagramSyntaxAnalysis';
import { diagramTextRanges, textRow, type DiagramTextRow } from './diagramText';
import { presentationHighlights, type DiagramPresentationSettings } from './diagramPresentation';

/** Immutable domain inputs are borrowed, never cloned. Source coordinates survive composition. */
export function diagramContentSnapshot(revision: DiagramRevision, settings?: DiagramPresentationSettings) {
  return { revisionId: revision.id, content: revision.diagram.content, nodeRefs: revision.nodeRefs,
    syntax: analyzeDiagramSyntax(revision.diagram, settings?.markerRules) };
}
export function projectSelectedDiagramRows(base: DiagramRevision, selections: RevisionSelections,
  displayNodeId: string, get: (id: string) => DiagramRevision, settings?: DiagramPresentationSettings, collapsedNodeRefs: ReadonlySet<string> = new Set()): DiagramTextRow[] {
  const ranges = new Map<string, ReturnType<typeof diagramTextRanges>>();
  const lines = new Map<string, string[]>();
  return resolveRevisionLines(base, selections, get, collapsedNodeRefs).map(source => {
    const revision = source.revision, diagram = revision.diagram;
    if (!ranges.has(revision.id)) {
      const snapshot = diagramContentSnapshot(revision, settings);
      ranges.set(revision.id, diagramTextRanges({ revisionId: diagram.revisionId, ascii: diagram.content.ascii, content: snapshot.content, displayNodeId,
        sourceContext: diagram.sourceContext, mappings: diagram.sourceContext.mappings, jumps: diagram.jumps,
        syntax: snapshot.syntax, presentation: settings, highlights: presentationHighlights(diagram, settings, snapshot.nodeRefs) }));
      lines.set(revision.id, diagram.content.ascii.split('\n'));
    }
    const row = textRow(lines.get(revision.id)![source.sourceLine - 1], ranges.get(revision.id)!.get(source.sourceLine) ?? [], source.sourceLine);
    return { ...row, runs: row.runs.map(run => run.owner?.contentNodeId ? { ...run,
      owner: { ...run.owner, nodeRef: revision.nodeRefs[run.owner.contentNodeId] } } : run) };
  });
}
