import { createDiagram } from '../../../domain/core/diagrams/diagram';
import { mappingsForSelection } from '../../../domain/core/diagrams/diagramSelection';
import type { ProjectRepresentationEvidenceRecord } from '../../../domain/core/representations/projectCatalog';
import { validateLocalChatRequest } from '../../../domain/mapping/chat/localChatPrompt';
import type { CorpusAccess } from '../../core/corpus/corpusAccess';
import type { DiagramRepository } from '../../core/ports/diagramRepository';
import { resolveDiagramSource } from '../../core/source/diagramSource';
import { mappingPocSourceContextForSelection } from '../selection/mappingPocSourceContext';
import type { LocalChatRuntime } from './agent';

export class LocalChatService {
  constructor(private readonly projects: Pick<DiagramRepository, 'loadProject' | 'projectCatalogs'>,
    private readonly corpus: CorpusAccess, private readonly runtime: LocalChatRuntime, private readonly sourceRoot: string) { }
  async prepare(value: unknown) {
    const input = validateLocalChatRequest(value);
    const { context, selection } = input;
    let sourceRoot = this.sourceRoot;
    let projectEvidence: Record<string, ProjectRepresentationEvidenceRecord> | undefined;
    if (context.projectId) {
      const project = await this.projects.loadProject();
      if (!project || project.id !== context.projectId) throw new Error("Diagram belongs to another Project");
      const catalog = await this.projects.projectCatalogs.loadRepresentationCatalog(project.id);
      const revision = catalog.revisions[context.baseRevisionId!];
      // Historical revisions remain valid: existing chats retain their original selection.
      if (!revision || revision.representationId !== context.representationId) throw new Error("Diagram revision does not belong to this representation");
      const captured = context.sourceContext;
      const live = captured && createDiagram({id: context.contentId, revision: context.diagramRevision, ascii: context.diagramAscii,
        source: captured.binding, mappings: captured.mappings, evidence: captured.evidence});
      if (live && captured!.contentHash !== live.content.asciiSha256) throw new Error('Diagram source context does not match content');
      const resolved = await resolveDiagramSource(this.projects, {projectId: project.id, representationId: context.representationId,
        revisionId: context.baseRevisionId, contentId: context.contentId}, this.corpus, live);
      projectEvidence = resolved.context.evidence;
      context.mappings = [...resolved.mappings()];
      sourceRoot = resolved.context.binding?.corpus.root ?? this.sourceRoot;
    }
    const sourceRanges = context.sourceRanges ?? (mappingsForSelection(context.mappings, selection.rect).length
      ? await mappingPocSourceContextForSelection({ sourceRoot, projectEvidence, mappings: context.mappings, selection: selection.rect }, this.corpus)
      : []);

    return { input, sourceRoot, sourceRanges };
  }
  reply(prepared: Awaited<ReturnType<LocalChatService['prepare']>>, options: {
    signal: AbortSignal; onProgress(message: string): void;
  }) {
    return this.runtime.reply(prepared.input, { sourceRoot: prepared.sourceRoot, sourceRanges: prepared.sourceRanges, ...options });
  }
}
