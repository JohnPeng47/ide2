import { type DiagramSourceContext } from '../../../domain/core/diagrams/diagram';
import { RevisionedDiagramService } from '../../../domain/core/diagrams/diagramService';
import type { DiagramElementMapping } from '../../../domain/core/records/domain';
import { ProjectDiagramConflict } from '../../../domain/core/representations/errors';
import type { ProjectRepresentationEvidenceRecord } from '../../../domain/core/representations/projectCatalog';
import { validateMappingPocMappings } from '../../../domain/mapping/selection/mappingPocPrompt';
import type { DiagramRepository } from '../../core/ports/diagramRepository';
import { resolveDiagramSource } from '../../core/source/diagramSource';
import type { MappingAgentRuntime } from './agent';

export class SelectionService {
  constructor(private readonly projects: Pick<DiagramRepository, 'loadProject' | 'projectCatalogs'>,
    private readonly runtime: MappingAgentRuntime, private readonly sourceRoot: string) { }

  async prepare(body: Record<string, unknown>) {
    const clientSessionId = typeof body.clientSessionId === "string" ? body.clientSessionId : "";
    const diagramAscii = typeof body.diagramAscii === "string" ? body.diagramAscii : "";
    const diagramRevision = Number(body.diagramRevision);
    const instruction = typeof body.instruction === "string" ? body.instruction : "";
    const rawSelection = body.selection as Record<string, unknown> | undefined;
    if (!/^[A-Za-z0-9-]{8,120}$/.test(clientSessionId)) {
      throw new Error("valid clientSessionId is required");
    }
    if (!diagramAscii || diagramAscii.length > 20000) {
      throw new Error("diagramAscii must contain at most 20000 characters");
    }
    if (!Number.isInteger(diagramRevision) || diagramRevision < 0) {
      throw new Error("diagramRevision must be a non-negative integer");
    }
    if (!instruction.trim() || instruction.length > 4000) {
      throw new Error("instruction must contain at most 4000 characters");
    }
    if (!rawSelection) throw new Error("selection is required");
    const selection = {
      startLine: Number(rawSelection.startLine),
      endLine: Number(rawSelection.endLine),
      startColumn: Number(rawSelection.startColumn),
      endColumn: Number(rawSelection.endColumn)
    };
    if (!Object.values(selection).every((value) => Number.isInteger(value) && value >= 1)) {
      throw new Error("selection coordinates must be positive integers");
    }
    if (body.operation !== undefined && body.operation !== "edit" && body.operation !== "generate") {
      throw new Error("operation must be edit or generate");
    }
    let mappings: DiagramElementMapping[] | undefined;
    if (body.mappings !== undefined) {
      try {
        if (!Array.isArray(body.mappings)) throw new Error("mappings must be an array");
        mappings = body.mappings as DiagramElementMapping[];
        validateMappingPocMappings(diagramAscii, mappings);
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : "invalid mappings");
      }
    }
    let projectEvidence: Record<string, ProjectRepresentationEvidenceRecord> | undefined;
    let sourceRoot = this.sourceRoot;
    if (body.representationId !== undefined || body.projectId !== undefined || body.baseRevisionId !== undefined) {
      const project = await this.projects.loadProject();
      if (!project || body.projectId !== project.id) throw new Error("Diagram belongs to another Project");
      const catalog = await this.projects.projectCatalogs.loadRepresentationCatalog(project.id);
      const representation = catalog.representations[String(body.representationId)];
      if (!representation || representation.status === "archived"
        || representation.currentRevisionId !== body.baseRevisionId) throw new ProjectDiagramConflict("Diagram revision has changed; reopen it before prompting");
      const context = body.sourceContext as DiagramSourceContext | undefined;
      const live = context && new RevisionedDiagramService().create({ id: String(body.contentId), revision: diagramRevision, ascii: diagramAscii,
        source: context.binding, mappings: context.mappings, evidence: context.evidence }).diagram;
      if (live && context!.contentHash !== live.content.asciiSha256) throw new Error('Diagram source context does not match content');
      const resolved = await resolveDiagramSource(this.projects, {projectId: project.id, representationId: representation.id,
        revisionId: representation.currentRevisionId, contentId: String(body.contentId)}, undefined, live);
      projectEvidence = Object.fromEntries(Object.entries(resolved.context.evidence).map(([id, evidence]) => [id, { ...evidence,
        sourceRanges: evidence.sourceRanges.map(range => ({ ...range, originalLines: [...range.originalLines] })) }]));
      mappings = [...resolved.mappings()];
      sourceRoot = resolved.context.binding?.corpus.root ?? this.sourceRoot;
      if (!mappings) throw new Error("Project diagram mappings are required");
    }

    return {
      operation: body.operation as 'edit' | 'generate' | undefined, mappings,
      clientSessionId, diagramAscii, diagramRevision, selection, instruction, sourceRoot, projectEvidence
    };
  }
  run(input: Awaited<ReturnType<SelectionService['prepare']>>, onProgress: Parameters<MappingAgentRuntime['promptDiagramSelection']>[1]) {
    return this.runtime.promptDiagramSelection(input, onProgress);
  }
}
