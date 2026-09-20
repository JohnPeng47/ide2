import { cp, readFile, writeFile, readdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDiagram, sourceBindingFromLocation, type DiagramSourceBinding } from '../../domain/core/diagrams/diagram';
import { projectCanvasSnapshot, sceneFromRevision } from '../../domain/core/diagrams/projectDiagramCanvas';
import { deserializeWorkspace } from '../../domain/mapping/workspace/mappingWorkspaceCodec';

export const TARGET_REPRESENTATION = 'representation-b697fd11-5c8d-49e7-a6b5-b12030f2f79a';
/** Explicit offline conversion only. No runtime fallback or scan of other projects. */
export function migrateScene(scene: any, evidence: Record<string, any>, binding?: DiagramSourceBinding, kind: 'tree'|'diagram' = 'diagram') {
  const next = structuredClone(scene);
  next.contents = Object.fromEntries(Object.entries(next.contents).map(([id, value]) => {
    const old = value as any;
    if (old.content && old.sourceContext) return [id, old];
    const mappings = old.mappings ?? [];
    // Keep the complete captured evidence so subsequent edits can reuse the same source context.
    return [id, createDiagram({ id, revision: old.revision, ascii: old.ascii,
      structureKind: old.structureKind ?? old.diagramContent?.structure?.kind ?? kind,
      source: id.endsWith('-summary') ? undefined : binding, mappings, evidence: id.endsWith('-summary') ? {} : evidence })];
  }));
  projectCanvasSnapshot(next);
  return next;
}
export function migrateWorkspace(workspace: any, binding?: DiagramSourceBinding) {
  const next = structuredClone(workspace);
  for (const doc of next.documents) {
    doc.document.scene = migrateScene(doc.document.scene, doc.document.evidence ?? {}, binding);
    doc.savedScene = JSON.stringify(migrateScene(JSON.parse(doc.savedScene), doc.document.evidence ?? {}, binding));
    delete doc.document.nodes; delete doc.document.evidence;
    for (const node of Object.values(doc.canvas.display.nodes) as any[]) {
      if (node.kind === 'projection' && node.content.kind === 'source-code') node.content.sourceId ??= binding?.sourceId;
      if (node.kind === 'projection' && node.content.files) for (const file of node.content.files) file.sourceId ??= binding?.sourceId;
      if (node.kind === 'conversation' && node.thread.context) {
        const ctx = node.thread.context, diagram = doc.document.scene.contents[ctx.contentId];
        if (diagram && diagram.content.ascii === ctx.diagramAscii) ctx.sourceContext = diagram.sourceContext;
      }
    }
  }
  return deserializeWorkspace(next);
}
export async function migrateDirectory(directory: string, representationId = TARGET_REPRESENTATION) {
  const root = path.resolve(directory);
  const project = JSON.parse(await readFile(path.join(root,'project.json'),'utf8'));
  const catalog = JSON.parse(await readFile(path.join(root,'representations/catalog.json'),'utf8'));
  if (representationId !== TARGET_REPRESENTATION || !catalog.representations[representationId]) throw new Error('Migration is scoped to the requested canvas-domain-model diagram directory');
  if (!project.canonicalRepoRoot) return {alreadyMigrated:true};
  const binding = sourceBindingFromLocation({checkoutRoot:project.canonicalRepoRoot,repositoryIdentity:project.repositoryIdentity,domainProfileId:project.domainProfileId,corpus:project.corpus});
  const writes = new Map<string,unknown>();
  for (const revision of Object.values(catalog.revisions) as any[]) {
    if (revision.content?.kind === 'mapping-canvas') {
      revision.content.scene = migrateScene(revision.content.scene, revision.evidence ?? {}, binding, revision.representationKind);
      const snapshot = projectCanvasSnapshot(revision.content.scene);
      revision.mappings = snapshot.mappings; revision.evidence = snapshot.evidence;
    } else {
      revision.source = binding;
      revision.content = {kind:"diagram",diagram:sceneFromRevision(revision).contents.overview};
      delete revision.source;
    }
  }
  for (const projection of Object.values(catalog.projections ?? {}) as any[]) for (const file of projection.compactionProjection?.files ?? []) file.sourceId = binding.sourceId;
  writes.set('representations/catalog.json', catalog);
  for (const setId of project.diagramSetIds) {
    const filename = `diagram-sets/${setId}/diagram-set.json`;
    const set = JSON.parse(await readFile(path.join(root,filename),'utf8'));
    set.source = sourceBindingFromLocation({checkoutRoot:set.sourceCheckoutRoot,repositoryIdentity:binding.repositoryIdentity,domainProfileId:binding.domainProfileId,gitRevision:set.gitRevision});
    writes.set(filename,set);
  }
  if ((await readdir(root)).includes('mapping-workspace.json')) writes.set('mapping-workspace.json', migrateWorkspace(JSON.parse(await readFile(path.join(root,'mapping-workspace.json'),'utf8')),binding));
  const {repositoryIdentity,canonicalRepoRoot,corpus,domainProfileId,...independentProject}=project;
  writes.set('project.json',{...independentProject,defaultDomainProfileId:domainProfileId ?? 'source-code'});
  // Prepare/validate all data before making the backup and writing any file.
  const backup = `${root}.before-diagram-sources-${Date.now()}`;
  await cp(root,backup,{recursive:true,errorOnExist:true,force:false});
  for (const [file,value] of writes) {
    const destination = path.join(root,file), temporary = `${destination}.migrating`;
    await writeFile(temporary,JSON.stringify(value,null,2)+'\n');
    await rename(temporary,destination);
  }
  return {backup,files:[...writes.keys()],sourceId:binding.sourceId};
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('Usage: tsx scripts/migrations/migrate-diagram-sources.ts <explicit-diagram-directory>');
  console.log(JSON.stringify(await migrateDirectory(process.argv[2]),null,2));
}
