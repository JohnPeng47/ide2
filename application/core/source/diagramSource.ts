import { createDiagram, validateDiagram, diagramSource, type Diagram, type DiagramSourceBinding } from '../../../domain/core/diagrams/diagram';
import { sceneFromRevision } from '../../../domain/core/diagrams/projectDiagramCanvas';
import type { DiagramRepository } from '../ports/diagramRepository';
import type { CorpusAccess } from '../corpus/corpusAccess';
import { ApplicationError } from '../errors';
export interface DiagramSourceReference { projectId: string; representationId?: string; revisionId?: string; contentId?: string; sourceId?: string }
/** Resolve a saved diagram/revision, or an unambiguous registered source. Never infer a repository from Project. */
export async function resolveDiagramSource(store: Pick<DiagramRepository,'loadProject'|'projectCatalogs'|'loadDiagramSet'>, ref: DiagramSourceReference, corpus?: CorpusAccess, liveDiagram?: Diagram) {
  const project = await store.loadProject();
  if (!project || project.id !== ref.projectId) throw new ApplicationError('conflict','Diagram belongs to another project');
  const catalog = await store.projectCatalogs.loadRepresentationCatalog(project.id);
  let diagram: Diagram | undefined;
  const representation = ref.representationId ? catalog.representations[ref.representationId] : undefined;
  const revisionId = ref.revisionId ?? representation?.currentRevisionId;
  if (ref.representationId && (!representation || !revisionId || !representation.revisionIds.includes(revisionId))) throw new Error('Unknown diagram revision');
  if (liveDiagram) {
    validateDiagram(liveDiagram);
    if (ref.contentId && liveDiagram.id !== ref.contentId) throw new Error('Live diagram identity does not match selection');
    diagram = liveDiagram;
  } else if (ref.representationId) {
    const scene = sceneFromRevision(catalog.revisions[revisionId!]);
    const candidates = Object.values(scene.contents).filter(d => ref.contentId ? d.id === ref.contentId : !!d.sourceContext.binding);
    if (candidates.length !== 1) throw new Error('Select an individual diagram with contentId');
    diagram = candidates[0];
  } else {
    const bindings = new Map<string,DiagramSourceBinding>();
    const register = (binding: DiagramSourceBinding) => {
      const old = bindings.get(binding.sourceId);
      if (old && (old.corpus.root !== binding.corpus.root || old.corpus.kind !== binding.corpus.kind || old.repositoryIdentity !== binding.repositoryIdentity)) throw new Error('Conflicting diagram source identity');
      bindings.set(binding.sourceId,binding);
    };
    for (const revision of Object.values(catalog.revisions)) for (const d of Object.values(sceneFromRevision(revision).contents)) {
      const binding = d.sourceContext.binding;
      if (binding && (!ref.sourceId || binding.sourceId === ref.sourceId)) register(binding);
    }
    for (const setId of project.diagramSetIds) {
      const binding = (await store.loadDiagramSet(setId)).source;
      if (binding && (!ref.sourceId || binding.sourceId === ref.sourceId)) register(binding);
    }
    if (bindings.size !== 1) throw new Error('A valid diagram sourceId is required; the project has no single repository');
    diagram = createDiagram({id:'source-query',revision:0,ascii:'Source',source:[...bindings.values()][0]});
  }
  if (ref.sourceId && diagram.sourceContext.binding?.sourceId !== ref.sourceId) throw new Error('Source does not belong to diagram');
  const query = diagramSource(diagram);
  const binding = () => {
    const result = query.context.binding;
    if (!result) throw new Error('This diagram has no source repository');
    return result;
  };
  return { ...query, diagram, binding,
    readText: (file: string) => { const source=binding(); if (!corpus) throw new Error('Source access unavailable'); return corpus.provider(source.corpus).readDocumentText(source.corpus,file); },
    listFiles: (directory: string) => { const source=binding(); if (!corpus) throw new Error('Source access unavailable'); return corpus.provider(source.corpus).listDirectory(source.corpus,directory); }
  };
}
