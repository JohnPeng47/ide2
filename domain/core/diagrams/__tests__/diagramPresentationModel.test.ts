import { expect, it } from 'vitest';
import { createDiagram, reviseDiagram } from '../diagramRevision';
import { getDiagramRevision, retainDiagramRevision } from '../diagramRevisionStore';
import { compareDiagramRevisions } from '../diagramDiff';
import { analyzeDiagramSyntax } from '../diagramSyntaxAnalysis';
import { diagramMarkerSpans } from '../diagramMarkers';
import { diagramContentSnapshot, projectSelectedDiagramRows } from '../../presentation/diagramRevisionProjection';
import { diagramTextRanges, textRow } from '../../presentation/diagramText';
import { revisionSelectionKey, migrateRevisionSelections } from '../diagramRevisionSelection';
import { MappingDocumentController } from '../../../mapping/workspace/mappingDocumentController';
import { initialCanvasState } from '../../../mapping/workspace/mappingWorkspace';
import { singleDiagramScene } from '../projectDiagramCanvas';
import { mappingDocumentFromScene } from '../../../mapping/workspace/mappingDocument';
import { projectDiagramDiffRows } from '../../presentation/diagramDiffProjection';
import { canvasNodeGraph } from '../../../mapping/workspace/canvasNodeGraph';

it('creates and compares immutable revisions without a service, store, canvas, or selected global head', () => {
  const base = createDiagram({ id: 'test', revision: 0, ascii: 'Root\n`-- Before', structureKind: 'tree' }).revision;
  expect(() => getDiagramRevision(base.id)).toThrow('Unknown diagram revision');
  const head = reviseDiagram(base, { kind: 'patch', start: 2, end: 2, patch: '`-- After' }).revision;
  expect(base.diagram.content.ascii).toContain('Before');
  expect(head.parentId).toBe(base.id);
  expect(Object.isFrozen(head.diagram.content)).toBe(true);
  expect(compareDiagramRevisions(base, head).counts.modified).toBeGreaterThan(0);
  const snapshot = diagramContentSnapshot(base);
  expect(snapshot.content).toBe(base.diagram.content);
  expect(snapshot.nodeRefs).toBe(base.nodeRefs);
  const ranges = (revision: typeof base) => diagramTextRanges({ ascii: revision.diagram.content.ascii,
    content: revision.diagram.content, displayNodeId: 'display', syntax: analyzeDiagramSyntax(revision.diagram) });
  const projection = projectDiagramDiffRows({ content: head.diagram.content, ranges: ranges(head), sourceLines: [1, 2],
    previous: base.diagram, previousRanges: ranges(base), diff: compareDiagramRevisions(base, head) });
  expect(projection.ascii).toContain('[-] Before');
  expect(projection.ascii).toContain('[+] After');
  expect(projection.rows.flatMap(row => row.runs).some(run => run.owner?.side === 'before')).toBe(true);
});

it('recognizes literal markers without changing text, handles escapes, whitespace, repeats and longest markers', () => {
  const rules = [{ id: 'review', marker: '!!' }, { id: 'short', marker: '!' }];
  const text = '!! someFunction() !! and !! Next !!';
  const spans = diagramMarkerSpans(text, rules);
  expect(spans.map(span => text.slice(span.start, span.end))).toEqual(['someFunction()', 'Next']);
  expect(spans.map(span => span.markerRuleId)).toEqual(['review', 'review']);
  expect(diagramMarkerSpans('!!bad!! !! unmatched', rules)).toEqual([]);
  expect(diagramMarkerSpans('\\!! escaped !!', rules)).toEqual([]);
  expect(diagramMarkerSpans('!!\tTabbed\t!!', rules)).toEqual([{ start: 3, end: 9, markerRuleId: 'review' }]);
});

it('composes marker foreground, explicit highlight background and symbol semantics using cached classifications', () => {
  const diagram = createDiagram({ id: 'styled', revision: 0, ascii: '!! someFunction() !!' }).diagram;
  const rules = [{ id: 'review', marker: '!!' }];
  const syntax = analyzeDiagramSyntax(diagram, rules);
  expect(analyzeDiagramSyntax(diagram, [...rules])).toBe(syntax);
  const ranges = diagramTextRanges({ ascii: diagram.content.ascii, content: diagram.content, displayNodeId: 'one', syntax,
    presentation: { markerStyles: { review: { color: '#ff0000', underline: true } } }, highlights: [{ id: 'h', color: 'yellow' }] });
  const row = textRow(diagram.content.ascii, ranges.get(1)!);
  expect(row.runs.map(run => run.text).join('')).toBe(diagram.content.ascii);
  expect(row.runs.find(run => run.text === 'someFunction')).toMatchObject({ syntax: { kind: 'function', role: 'reference' }, markerRuleId: 'review',
    decoration: { color: '#ff0000', backgroundColor: '#facc1555', textDecoration: 'underline' } });
  expect(analyzeDiagramSyntax(diagram, [])).not.toBe(syntax);
});

it('selects a subtree revision without any review record and retains row provenance', () => {
  const base = createDiagram({ id: 'selected', revision: 0, ascii: 'Root\n|-- First\n`-- Keep', structureKind: 'tree' }).revision;
  const owner = Object.values(base.nodeRefs)[1];
  const head = reviseDiagram(base, { kind: 'replace', input: { ascii: 'Root\n|-- Changed\n`-- Keep', structureKind: 'tree' }, nodeCorrespondence: { [owner]: 2 } }).revision;
  const revisions = { [base.id]: base, [head.id]: head };
  const rows = projectSelectedDiagramRows(base, { revisionSelections: {
    [revisionSelectionKey('selected', owner, null)]: { contentId: 'selected', ownerNodeId: owner, contextRevisionId: null, revisionId: head.id }
  } }, 'display', id => revisions[id]);
  expect(rows.map(row => row.text).join('\n')).toBe('Root\n|-- Changed\n`-- Keep');
  expect(rows[1].runs.find(run => run.owner?.contentNodeId)?.owner?.revisionId).toBe(head.diagram.content.revisionId);
  expect(rows[2].runs.find(run => run.owner?.contentNodeId)?.owner?.revisionId).toBe(base.diagram.content.revisionId);
});

it('persists highlights and marker settings through undo/reload without issuing a content revision', () => {
  const controller = new MappingDocumentController(mappingDocumentFromScene(singleDiagramScene('!! someFunction() !!')), initialCanvasState());
  const original = controller.getSnapshot().document.scene.contents.overview;
  controller.applyUpdate(0, [{ method: 'setPresentation', nodeId: 'grid:overview', settings: {
    markerRules: [{ id: 'review', marker: '!!' }], markerStyles: { review: { color: 'orange' } },
    highlights: [{ id: 'text', color: 'yellow', revisionId: original.revisionId, textRange: { startLine: 1, endLine: 1, startColumn: 4, endColumn: 15 } }]
  } }]);
  expect(controller.getSnapshot().document.scene.contents.overview.revisionId).toBe(original.revisionId);
  const state = controller.getSnapshot();
  expect(canvasNodeGraph(state.document).nodes[0]).toMatchObject({ kind: 'diagram', content: { revisionId: original.revisionId } });
  const reopened = new MappingDocumentController(state.document, state.canvas, 0, undefined, undefined, controller.exportHistory());
  expect(reopened.getSnapshot().document.diagramPresentations?.overview.highlights).toHaveLength(1);
  reopened.undo(); expect(reopened.getSnapshot().document.diagramPresentations).toBeUndefined();
  reopened.undo(true); expect(reopened.getSnapshot().document.diagramPresentations?.overview.markerRules).toHaveLength(1);
});

it('migrates legacy variant selections to pinned revision choices without mutating saved input', () => {
  const old = { variants: { choice: { id: 'choice', headRevisionId: 'head', baseRevisionId: 'base' } },
    variantSelections: { oldKey: { contentId: 'd', ownerNodeId: 'root', contextVariantId: null, activeVariantId: 'choice' } } };
  const before = JSON.stringify(old), next = migrateRevisionSelections(old);
  expect(JSON.stringify(old)).toBe(before);
  expect(next.revisionSelections?.[revisionSelectionKey('d', 'root', null)]).toMatchObject({ revisionId: 'head', baseRevisionId: 'base' });
  expect('variants' in next).toBe(false);
});

it('folds new nodes from a selected revision and keeps its revision pinned through reload', () => {
  const controller = new MappingDocumentController(mappingDocumentFromScene(singleDiagramScene('Root\n`-- Original')), initialCanvasState());
  const base = getDiagramRevision(controller.getSnapshot().document.scene.contents.overview.revisionId);
  const head = retainDiagramRevision(reviseDiagram(base, { kind: 'replace', input: {
    ascii: 'Root\n`-- New branch\n    `-- New leaf', structureKind: 'tree'
  }, nodeCorrespondence: { [Object.values(base.nodeRefs)[0]]: 1 } })).revision;
  controller.applyUpdate(0, [{ method: 'revision-select', nodeId: 'grid:overview', ownerNodeId: 'root', contextRevisionId: null, revisionId: head.id }]);
  const node = controller.nodes().find(node => node.id === 'grid:overview')!;
  const branch = node.collapsible.subtrees.find(node => node.label === 'New branch')!;
  expect(branch.visibleRow).toBe(1);
  const bounds = node.geometry;
  controller.applyUpdate(1, [{ method: 'collapse', nodeId: 'grid:overview', contentNodeId: branch.contentNodeId, collapsed: true }]);
  expect(controller.nodes().find(node => node.id === 'grid:overview')!.textRows!.map(row => row.text).join('\n')).toBe('Root\n`-- New branch');
  expect(controller.nodes().find(node => node.id === 'grid:overview')!.geometry).toEqual(bounds);
  const state = controller.getSnapshot();
  const reopened = new MappingDocumentController(state.document, state.canvas, 0, undefined, undefined, controller.exportHistory());
  expect(reopened.nodes().find(node => node.id === 'grid:overview')!.textRows).toHaveLength(2);
  reopened.undo();
  expect(reopened.nodes().find(node => node.id === 'grid:overview')!.textRows).toHaveLength(3);
  expect(reopened.getSnapshot().document.scene.contents.overview.revisionId).toBe(base.id);
});

it('pins text highlights to the exact revision, even when sibling revisions share a content version', () => {
  const base = createDiagram({ id: 'siblings', revision: 0, ascii: 'Before' }).revision;
  const left = reviseDiagram(base, { kind: 'replace', input: { ascii: 'Left' } }).revision;
  const right = reviseDiagram(base, { kind: 'replace', input: { ascii: 'Right' } }).revision;
  expect(left.diagram.content.revisionId).toBe(right.diagram.content.revisionId);
  const revisions = { [base.id]: base, [left.id]: left, [right.id]: right };
  const settings = { highlights: [{ id: 'text', color: 'yellow' as const, revisionId: left.id,
    textRange: { startLine: 1, endLine: 1, startColumn: 1, endColumn: 4 } }] };
  const rows = (revisionId: string) => projectSelectedDiagramRows(base, { revisionSelections: {
    [revisionSelectionKey('siblings', 'root', null)]: { contentId: 'siblings', ownerNodeId: 'root', contextRevisionId: null, revisionId }
  } }, 'display', id => revisions[id], settings);
  expect(rows(left.id)[0].runs.some(run => run.decoration?.backgroundColor)).toBe(true);
  expect(rows(right.id)[0].runs.some(run => run.decoration?.backgroundColor)).toBe(false);
});
