import type { DiagramPlacement } from '../../core/diagrams/diagramPlacement';

export interface PlacementBinding {
  generated: DiagramPlacement;
  promoted: DiagramPlacement;
}
/** Immutable promotion baseline. Later measurements will reference these instance mappings. */
export interface PlacementLineage {
  schemaVersion: 1;
  coordinateSpace: 'canvas-grid';
  source: { runId: string; cellKey: string };
  promotedAt: string;
  diagrams: (PlacementBinding & { promoted: DiagramPlacement & { checkpointId: string; canvasRevisionId: string } })[];
}

import { diagramPlacements } from '../../core/diagrams/diagramPlacement';
import { documentFromRevision, historyFromRevision } from '../../core/diagrams/projectDiagramCanvas';
import { stateKey } from '../../core/diagrams/canvasHistory';
import type { EvalOutputResult } from './evalOutputResult';
import type { PromotionReceipt } from './outputPromotion';
import type { ProjectRepresentationCatalogRecord } from '../../core/representations/projectCatalog';
import type { LineGridScene } from '../../core/diagrams/lineGrid';

/** Historical whole-canvas copies retained display IDs and geometry. Never infer lineage from names. */
export function backfillPlacementLineage(result: EvalOutputResult, source: PlacementLineage['source'],
  receipt: PromotionReceipt, catalog: ProjectRepresentationCatalogRecord): PlacementLineage {
  const fingerprint = (scene: LineGridScene) => stateKey(diagramPlacements(scene, '').map(p => ({
    diagramId: p.diagramId, contentId: p.contentId, column: p.column, row: p.row, ascii: scene.contents[p.contentId].content.ascii
  })).sort((a, b) => a.diagramId.localeCompare(b.diagramId)));
  const used = new Set<string>();
  const diagrams: PlacementLineage['diagrams'] = [];
  const times: string[] = [];
  for (const promotedCanvas of receipt.canvases) {
    const record = catalog.representations[promotedCanvas.id];
    const revision = record && catalog.revisions[record.revisionIds[0]];
    if (!revision) throw Error('Original promotion revision is unavailable');
    const history = historyFromRevision(revision), document = documentFromRevision(revision);
    const hash = fingerprint(document.scene);
    const matches = result.canvases.filter(c => fingerprint(c.proposed.document.scene) === hash);
    if (matches.length !== 1 || used.has(matches[0].id)) throw Error('Cannot uniquely verify the generated canvas for this promotion');
    const original = matches[0]; used.add(original.id); times.push(revision.createdAt);
    const generated = diagramPlacements(original.proposed.document.scene, original.id);
    for (const promoted of diagramPlacements(document.scene, record.id)) {
      const baseline = generated.find(p => p.diagramId === promoted.diagramId)!;
      diagrams.push({ generated: baseline, promoted: { ...promoted, checkpointId: history.headId, canvasRevisionId: revision.id } });
    }
  }
  return { schemaVersion: 1, coordinateSpace: 'canvas-grid', source, promotedAt: times.sort()[0], diagrams };
}
