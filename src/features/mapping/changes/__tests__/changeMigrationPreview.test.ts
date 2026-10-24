import { expect, it } from 'vitest';
import { revisionFixture } from '../../../../../tests/support/diagramRevisions';
import { diagramContentNodes } from '../../../../../domain/core/diagrams/diagramContentNodes';
import { singleDiagramScene } from '../../../../../domain/core/diagrams/projectDiagramCanvas';
import { mappingDocumentFromScene } from '../../../../../domain/mapping/workspace/mappingDocument';
import { initialCanvasState } from '../../../../../domain/mapping/workspace/mappingWorkspace';
import type { ChangePreviewDocument } from '../../../../../domain/mapping/changes/diagramChangeSession';
import { resolveMigrationEndpoint, type DiagramMigration } from '../../../../../domain/mapping/changes/diagramMigration';
import { diffChangeDocument } from '../../../../../domain/mapping/changes/changeDocumentDiff';
import { changeMigrationPreview, migrationMarkKey } from '../changeMigrationPreview';
import { projectDiagramComparisons } from '../../../../../domain/mapping/workspace/diagramDiffProjection';

function fixture() {
  const state = (ascii: string, revision: number) => {
    const scene = singleDiagramScene(ascii);
    scene.contents = { ...scene.contents, overview: revisionFixture().create({ id: 'overview', revision, ascii, structureKind: 'tree' }).diagram };
    return { document: mappingDocumentFromScene(scene), canvas: initialCanvasState() };
  };
  const doc: ChangePreviewDocument = { id: 'doc', name: 'Canvas', version: 1,
    baseline: state('Root\n|-- Source\n|   `-- Child\n`-- Destination', 0), proposed: state('Root\n`-- Destination', 1) };
  const before = doc.baseline!.document.scene.contents.overview.content, after = doc.proposed.document.scene.contents.overview.content;
  const node = (content: typeof before, label: string) => diagramContentNodes(content).find(n => n.label === label)!;
  const migration: DiagramMigration = { id: 'U', title: 'Ownership', description: 'Move ownership to destination', kind: 'feature-ownership',
    source: { documentId: 'doc', displayNodeId: 'grid:overview', contentNodeId: node(before, 'Source').id, revisionId: before.revisionId, snapshot: 'baseline', scope: 'subtree' },
    destination: { documentId: 'doc', displayNodeId: 'grid:overview', contentNodeId: node(after, 'Destination').id, revisionId: after.revisionId, snapshot: 'proposed', scope: 'node' } };
  return { doc, migration };
}

it('decorates removed source subtrees and unchanged destinations without creating live ghost anchors', () => {
  const { doc, migration } = fixture(), original = structuredClone(doc);
  const preview = changeMigrationPreview(doc, [migration]);
  expect(preview.baseline.size).toBe(2);
  expect(preview.proposed.get(migrationMarkKey('grid:overview', migration.destination.contentNodeId))).toMatchObject([{ role: 'destination' }]);
  const diff = diffChangeDocument(doc);
  const text = projectDiagramComparisons(doc.proposed.document.scene, undefined, diff.diagrams, new Set(['grid:overview']), [], preview.baseline);
  const runs = text.rows.flatMap(row => row.runs).filter(run => run.migrations?.length);
  expect(runs.map(run => run.text)).toEqual(['Source', 'Child']);
  expect(runs.every(run => !run.owner)).toBe(true);
  expect(doc).toEqual(original);
  expect(preview.endpoints[0].resolved?.node.label).toBe('Source');
  expect(preview.endpoints[0].focusContentNodeId).toBeUndefined();
});

it('retains a baseline excerpt when the source diagram is removed entirely', () => {
  const { doc, migration } = fixture();
  if (doc.proposed.document.scene.root.kind !== 'container') throw Error();
  doc.proposed.document.scene.root = { ...doc.proposed.document.scene.root, children: [] };
  const preview = changeMigrationPreview(doc, [migration]);
  expect(preview.endpoints[0].resolved?.nodes.map(node => node.label)).toEqual(['Source', 'Child']);
  expect(preview.endpoints[1].error).toContain('missing');
});

it('marks surviving source nodes through explicit origins and flags stale proposed references', () => {
  const { doc, migration } = fixture();
  doc.proposed = structuredClone(doc.baseline!);
  const destination = diagramContentNodes(doc.proposed.document.scene.contents.overview.content).find(n => n.label === 'Destination')!;
  const preview = changeMigrationPreview(doc, [migration]);
  expect(preview.endpoints[0].focusContentNodeId).toBe(migration.source.contentNodeId);
  expect(preview.endpoints[1].error).toContain('revision is stale');
  migration.destination.contentNodeId = destination.id;
  migration.destination.revisionId = doc.proposed.document.scene.contents.overview.content.revisionId;
  migration.source.snapshot = 'proposed';
  const valid = changeMigrationPreview(doc, [migration]);
  expect(valid.proposed.size).toBe(3);
  expect(resolveMigrationEndpoint(doc, migration.source).nodes).toHaveLength(2);
  const invalid = { ...migration.source, contentNodeId: 'missing' };
  expect(() => resolveMigrationEndpoint(doc, invalid)).toThrow('content node is stale');
});

it('keeps an edited baseline source on the previous row, with no false current anchor', () => {
  const { doc, migration } = fixture();
  const scene = singleDiagramScene('Root\n|-- Delegates undo\n|   `-- Child\n`-- Destination');
  scene.contents = { ...scene.contents, overview: revisionFixture().create({ id: 'overview', revision: 1,
    ascii: 'Root\n|-- Delegates undo\n|   `-- Child\n`-- Destination', structureKind: 'tree' }).diagram };
  doc.proposed.document = mappingDocumentFromScene(scene);
  const preview = changeMigrationPreview(doc, [migration]);
  const diff = diffChangeDocument(doc);
  const text = projectDiagramComparisons(scene, undefined, diff.diagrams, new Set(['grid:overview']), [], preview.baseline);
  const previous = text.rows.flatMap(row => row.runs).find(run => run.text === 'Source');
  expect(previous).toMatchObject({ diffVersion: 'previous', migrations: [{ id: 'U', role: 'source' }] });
  expect(previous?.owner).toBeUndefined();
  expect(text.rows.some(row => row.text.includes('[+] Delegates undo'))).toBe(true);
});
