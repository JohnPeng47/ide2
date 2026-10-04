import { z } from 'zod';
import { diagramContentNodes } from '../../core/diagrams/diagramContentNodes';
import { findBox } from '../workspace/canvasDisplayNode';
import type { ChangePreviewDocument } from './diagramChangeSession';

const id = z.string().min(1).max(200);
export const migrationEndpointSchema = z.object({
  documentId: id, displayNodeId: id, contentNodeId: z.string().min(1).max(1000), revisionId: id,
  snapshot: z.enum(['baseline', 'proposed']), scope: z.enum(['node', 'subtree']).default('node')
}).strict();
export const diagramMigrationSchema = z.object({
  id, title: z.string().trim().min(1).max(200), description: z.string().trim().min(1).max(4000),
  kind: z.enum(['code-organization', 'feature-ownership']),
  source: migrationEndpointSchema,
  destination: migrationEndpointSchema.extend({ snapshot: z.literal('proposed') })
}).strict();
export type MigrationEndpoint = z.infer<typeof migrationEndpointSchema>;
export type DiagramMigration = z.infer<typeof diagramMigrationSchema>;
export type MigrationRole = 'source' | 'destination';

/** Resolve only exact persisted identities. Heuristic diff matches are not endpoint identities. */
export function resolveMigrationEndpoint(doc: ChangePreviewDocument | undefined, endpoint: MigrationEndpoint) {
  if (!doc || doc.id !== endpoint.documentId) throw Error('Unknown migration document');
  const state = doc[endpoint.snapshot];
  const box = state && endpoint.displayNodeId.startsWith('grid:')
    ? findBox(state.document.scene.root, endpoint.displayNodeId.slice(5)) : undefined;
  if (!state || box?.kind !== 'diagram') throw Error('Migration diagram is missing');
  const content = state.document.scene.contents[box.contentId].content;
  if (content.revisionId !== endpoint.revisionId) throw Error('Migration endpoint revision is stale; reread and update the endpoint');
  const nodes = diagramContentNodes(content), node = nodes.find(n => n.id === endpoint.contentNodeId);
  if (!node) throw Error('Migration content node is stale; reread and update the endpoint');
  const selected = new Set([node.id]);
  if (endpoint.scope === 'subtree') {
    const add = (id: string) => { for (const child of nodes.find(n => n.id === id)?.childIds ?? []) { selected.add(child); add(child); } };
    add(node.id);
  }
  return { content, node, nodes: nodes.filter(n => selected.has(n.id)) };
}

export function migrationIssues(documents: readonly ChangePreviewDocument[], migrations: readonly DiagramMigration[]) {
  const issues: { migrationId: string; role: MigrationRole; message: string }[] = [];
  const ids = new Set<string>();
  for (const migration of migrations) {
    if (ids.has(migration.id)) issues.push({ migrationId: migration.id, role: 'source', message: 'Duplicate migration ID' });
    ids.add(migration.id);
    for (const role of ['source', 'destination'] as const) {
      try { resolveMigrationEndpoint(documents.find(doc => doc.id === migration[role].documentId), migration[role]); }
      catch (error) { issues.push({ migrationId: migration.id, role, message: (error as Error).message }); }
    }
  }
  return issues;
}
