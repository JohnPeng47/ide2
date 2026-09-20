import type { BuiltInDomainProfileId } from '../../../domain/core/profiles/domainProfile';
import { isBuiltInDomainProfileId } from '../../../domain/core/profiles/domainProfiles';
import type { MaterializedDiagramSetInput } from '../../../domain/core/records/domain';
import type { StudioApplication } from '../application';

export class DiagramSetWorkflow {
  constructor(private readonly application: StudioApplication, private readonly configuredDomainProfileId?: BuiltInDomainProfileId) { }
  async prepare(body: Record<string, unknown>) {
    const inputPath = typeof body.path === "string" ? body.path : "";
    const name = typeof body.name === "string" ? body.name : "";
    const prompt = typeof body.prompt === "string" ? body.prompt : "";
    const existingProject = await this.application.store.loadProject();
    const requestedDomain = body.domainProfileId
      ?? body.domain
      ?? this.configuredDomainProfileId
      ?? existingProject?.defaultDomainProfileId
      ?? "source-code";
    if (!isBuiltInDomainProfileId(requestedDomain)) {
      throw new Error(`unsupported domain profile: ${String(requestedDomain)}`);
    }
    const referencePrompt = typeof body.referencePrompt === "string"
      ? body.referencePrompt
      : undefined;
    const runReferencePrompt = body.runReferencePrompt === true;
    const requestedPromptTemplateId = body.promptTemplateId;
    const requestedCodeEntityPromptTemplateId = body.codeEntityPromptTemplateId;
    if (!inputPath || !name.trim()) {
      throw new Error("corpus path and DiagramSet name are required");
    }
    const creationMode = body.creationMode ?? "generate";
    if (creationMode !== "generate" && creationMode !== "materialized") {
      throw new Error("creationMode must be generate or materialized");
    }
    if (creationMode === "materialized") {
      if (!Array.isArray(body.codeEntities) || body.codeEntities.length === 0) {
        throw new Error("materialized DiagramSet creation requires at least one CodeEntity");
      }
      if (!Array.isArray(body.diagrams) || body.diagrams.length === 0) {
        throw new Error("materialized DiagramSet creation requires at least one ASCII Diagram");
      }
      if (body.promptTemplateId !== undefined
        || body.codeEntityPromptTemplateId !== undefined
        || body.referencePrompt !== undefined
        || body.runReferencePrompt !== undefined) {
        throw new Error("prompt-generation fields are not valid in materialized mode");
      }
      const materialized = await this.application.createMaterializedDiagramSet({
        ...body,
        creationMode: "materialized",
        path: inputPath,
        name,
        domainProfileId: requestedDomain
      } as unknown as MaterializedDiagramSetInput);
      return { mode: 'materialized' as const, materialized, inputPath, requestedDomain };
    }
    if (body.codeEntities !== undefined || body.diagrams !== undefined || body.featuredViews !== undefined) {
      throw new Error("materialized CodeEntities and Diagrams require creationMode=materialized");
    }
    await this.application.validateDiagramSetTarget(inputPath, requestedDomain);
    const promptTemplate = await this.application.resolveSystemPromptTemplate(
      requestedPromptTemplateId
    );
    const codeEntityPromptTemplate = await this.application.resolveCodeEntityPromptTemplate(
      requestedCodeEntityPromptTemplateId,
      requestedDomain
    );
    return {
      mode: 'generate' as const, inputPath, name, prompt, requestedDomain, promptTemplate,
      codeEntityPromptTemplate, runReferencePrompt, referencePrompt
    };
  }
  async run(prepared: Awaited<ReturnType<DiagramSetWorkflow['prepare']>>, onEvent: (event: unknown) => void) {
    if (prepared.mode === 'materialized') {
      const { materialized, inputPath, requestedDomain } = prepared;
      onEvent({
        type: 'created', creationMode: 'materialized', diagramSetId: materialized.diagramSetId,
        projectRoot: inputPath, domainProfileId: requestedDomain
      });
      onEvent({
        type: 'result', creationMode: 'materialized', diagramSetId: materialized.diagramSetId,
        codeEntityIdsByKey: materialized.codeEntityIdsByKey, diagramIdsByKey: materialized.diagramIdsByKey,
        workspace: materialized.workspace
      });
      return;
    }
    const { inputPath, name, prompt, requestedDomain, promptTemplate, codeEntityPromptTemplate, runReferencePrompt, referencePrompt } = prepared;
    const diagramSet = await this.application.createDiagramSet({
      path: inputPath,
      name,
      prompt,
      domainProfileId: requestedDomain
    });
    onEvent({
      type: "created",
      diagramSetId: diagramSet.id,
      projectRoot: diagramSet.sourceCheckoutRoot,
      domainProfileId: requestedDomain,
      promptTemplateId: promptTemplate.id,
      codeEntityPromptTemplateId: codeEntityPromptTemplate.id
    });
    await this.application.collectCodeEntities(
      diagramSet.id,
      { promptTemplateId: codeEntityPromptTemplate.id },
      (event) => onEvent(event)
    );
    const workspace = await this.application.generateInitialDiagrams(
      diagramSet.id,
      {
        promptTemplateId: promptTemplate.id,
        runReferencePrompt,
        referencePrompt
      },
      (event) => onEvent(event)
    );
    const completedSet = workspace.diagramSets.find((set) => set.id === diagramSet.id);
    const batchId = completedSet?.generationBatchIds.at(-1);
    const batch = batchId ? workspace.generationBatches[batchId] : undefined;
    const promptConfig = batch
      ? workspace.generationPromptConfigs[batch.promptConfigId]
      : undefined;
    const codeEntitySet = completedSet
      ? workspace.codeEntitySets[completedSet.codeEntitiesSetId]
      : undefined;
    const codeEntityPromptConfig = codeEntitySet?.promptConfigId
      ? workspace.codeEntityPromptConfigs[codeEntitySet.promptConfigId]
      : undefined;
    onEvent({
      type: "result",
      diagramSetId: diagramSet.id,
      promptTemplateId: promptConfig?.systemPrompt.profileId,
      promptTemplateVersion: promptConfig?.systemPrompt.profileVersion,
      generationPromptConfigId: promptConfig?.id,
      codeEntityPromptTemplateId: codeEntityPromptConfig?.template.profileId,
      codeEntityPromptTemplateVersion: codeEntityPromptConfig?.template.profileVersion,
      codeEntityPromptConfigId: codeEntityPromptConfig?.id,
      workspace
    });
  }
}
