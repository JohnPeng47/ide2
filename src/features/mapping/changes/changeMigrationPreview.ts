import { resolveMigrationEndpoint, type DiagramMigration, type MigrationRole, type MigrationEndpoint } from '../../../../domain/mapping/changes/diagramMigration';
import type { ChangePreviewDocument } from '../../../../domain/mapping/changes/diagramChangeSession';
import { diagramContentNodes } from '../../../../domain/core/diagrams/diagramContentNodes';
import { findBox } from '../../../../domain/mapping/workspace/canvasDisplayNode';

export interface MigrationMark { id: string; role: MigrationRole; title: string }
interface PreviewEndpoint {
  migration: DiagramMigration; role: MigrationRole; endpoint: MigrationEndpoint;
  resolved?: ReturnType<typeof resolveMigrationEndpoint>; focusContentNodeId?: string; error?: string;
}
export const migrationMarkKey = (displayNodeId: string, contentNodeId: string) => JSON.stringify([displayNodeId, contentNodeId]);
export function changeMigrationPreview(doc: ChangePreviewDocument, migrations: readonly DiagramMigration[]) {
  const proposed = new Map<string, MigrationMark[]>(), baseline = new Map<string, MigrationMark[]>();
  const endpoints = migrations.flatMap(migration => (['source', 'destination'] as const).flatMap<PreviewEndpoint>(role => {
    const endpoint = migration[role];
    if (endpoint.documentId !== doc.id) return [];
    const mark = { id: migration.id, role, title: migration.title };
    const add = (map: typeof proposed, nodeId: string) => {
      const key = migrationMarkKey(endpoint.displayNodeId, nodeId);
      map.set(key, [...(map.get(key) ?? []), mark]);
    };
    try {
      const resolved = resolveMigrationEndpoint(doc, endpoint);
      let focusContentNodeId: string | undefined;
      if (endpoint.snapshot === 'proposed') {
        resolved.nodes.forEach(node => add(proposed, node.id));
        focusContentNodeId = resolved.node.id;
      } else {
        resolved.nodes.forEach(node => add(baseline, node.id));
        const box = findBox(doc.proposed.document.scene.root, endpoint.displayNodeId.slice(5));
        const content = box?.kind === 'diagram' ? doc.proposed.document.scene.contents[box.contentId].content : undefined;
        // Explicit provenance only; semantic ownership never follows fuzzy label matches.
        for (const node of content ? diagramContentNodes(content) : []) {
          const original = resolved.nodes.find(old => old.id === node.id || doc.proposed.nodeOrigins?.[node.id] === old.id);
          if (original) {
            add(proposed, node.id);
            if (original.id === resolved.node.id) focusContentNodeId = node.id;
          }
        }
      }
      return [{ migration, role, endpoint, resolved, focusContentNodeId, error: undefined }];
    } catch (error) {
      return [{ migration, role, endpoint, resolved: undefined, focusContentNodeId: undefined, error: (error as Error).message }];
    }
  }));
  return { proposed, baseline, endpoints };
}
export type MigrationPreview = ReturnType<typeof changeMigrationPreview>;
