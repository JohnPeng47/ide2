import type { WorkspaceBatch } from '../../../domain/mapping/workspace/workspaceRecords';
import { ApplicationError } from '../../core/errors';
import type { DiagramRepository } from '../../core/ports/diagramRepository';
import type { MappingWorkspaceRepository } from './repository';
import { loadDiagramAgentContext, storeDiagramAgentContext, type DiagramAgentContext, type DiagramAgentContextStore } from '../../../domain/core/diagrams/diagramAgentContext';
import { deserializeWorkspace } from '../../../domain/mapping/workspace/mappingWorkspaceCodec';

export class MappingWorkspaceService {
  constructor(private readonly projects: Pick<DiagramRepository, 'loadProject'>, private readonly workspace: MappingWorkspaceRepository,
    private readonly diagramContexts?: DiagramAgentContextStore) { }
  async loadRecords(historyValidation: import('../../../domain/core/diagrams/canvasHistory').HistoryValidation = 'all') {
    const project = await this.projects.loadProject();
    if (!project) throw new ApplicationError('invalid-input', 'Project is not initialized');
    return this.workspace.loadRecords(project.id, historyValidation);
  }
  async applyBatch(input: WorkspaceBatch) {
    const project = await this.projects.loadProject();
    if (!project) throw new ApplicationError('invalid-input', 'Project is not initialized');
    return this.workspace.applyBatch(project.id, input);
  }
  async load() {
    const project = await this.projects.loadProject();
    return project ? this.workspace.load(project.id) : null;
  }
  async save(input: unknown) {
    const project = await this.projects.loadProject();
    if (!project) throw new ApplicationError('invalid-input', 'Project is not initialized');
    await this.workspace.save(project.id, input);
    return { saved: true };
  }
  /** Expand disk references at the export boundary so the JSON can be imported on another machine. */
  async portableExport(input: unknown) {
    const project = await this.projects.loadProject();
    if (!project) throw new ApplicationError('invalid-input', 'Project is not initialized');
    const workspace = deserializeWorkspace(input);
    if (workspace.projectId !== project.id) throw new ApplicationError('invalid-input', 'Workspace belongs to another project');
    const expanded = new Map<string, Awaited<ReturnType<typeof loadDiagramAgentContext>>>();
    const contexts = async (values?: Record<string, DiagramAgentContext>) => {
      if (!values) return values;
      return Object.fromEntries(await Promise.all(Object.entries(values).map(async ([id, value]) => {
        const key = value.backingRecordId ?? value.snapshot?.contentHash ?? id;
        let snapshot = expanded.get(key);
        if (!snapshot) { snapshot = await loadDiagramAgentContext(value, this.diagramContexts); expanded.set(key, snapshot); }
        return [id, { diagramId: value.diagramId, compiledFromRevisionId: value.compiledFromRevisionId,
          sourceFingerprint: value.sourceFingerprint, contentHash: snapshot.contentHash, snapshot } satisfies DiagramAgentContext];
      })));
    };
    for (const document of workspace.documents) {
      document.document.diagramContexts = await contexts(document.document.diagramContexts);
      if (document.history) for (const checkpoint of Object.values(document.history.snapshots))
        checkpoint.document.diagramContexts = await contexts(checkpoint.document.diagramContexts);
    }
    return deserializeWorkspace(workspace);
  }
  /** Save context files before an imported workspace can publish their references. */
  async prepareImport(input: unknown) {
    const project = await this.projects.loadProject();
    if (!project) throw new ApplicationError('invalid-input', 'Project is not initialized');
    if (!this.diagramContexts) throw Error('AGENT_CONTEXT_STORAGE_UNAVAILABLE');
    const workspace = deserializeWorkspace(input);
    if (workspace.projectId !== project.id) throw new ApplicationError('invalid-input', 'Workspace belongs to another project');
    const stored = new Map<string, Awaited<ReturnType<typeof storeDiagramAgentContext>>>();
    const contexts = async (values?: Record<string, DiagramAgentContext>) => {
      if (!values) return values;
      return Object.fromEntries(await Promise.all(Object.entries(values).map(async ([id, value]) => {
        if (!value.snapshot) throw Error('Workspace import requires portable diagram context snapshots');
        const key = value.snapshot.contentHash;
        let bound = stored.get(key);
        if (!bound) { bound = await storeDiagramAgentContext(value, this.diagramContexts!); stored.set(key, bound); }
        return [id, bound];
      })));
    };
    for (const document of workspace.documents) {
      document.document.diagramContexts = await contexts(document.document.diagramContexts);
      if (document.history) for (const checkpoint of Object.values(document.history.snapshots))
        checkpoint.document.diagramContexts = await contexts(checkpoint.document.diagramContexts);
    }
    return deserializeWorkspace(workspace);
  }
}
