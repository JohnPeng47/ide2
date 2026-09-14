import {
  CodeEntity,
  Diagram,
  DiagramComponent,
  SCHEMA_VERSION,
  createCodeEntityPromptAliases,
  isDiagramArchived,
  isDiagramComponentArchived,
  type CodeEntitiesSetRecord,
  type CodeEntityPromptAlias,
  type CodeEntityRecord,
  type DiagramComponentRecord,
  type DiagramModelId,
  type DiagramRecord,
  type DiagramSetRecord,
  type DiagramViewKind,
  type GenerationDerivationRecord,
  type GenerationOutputKind,
  type GenerationPromptConfigRecord,
  type GenerationPromptReference,
  type GenerationReferenceSelection,
  type GenerationTargetKind,
  type PromptReference,
  type SystemPromptTemplateRecord
} from "../../core/records/domain";
import type { BuiltInDomainProfileId } from "../../core/profiles/domainProfile";
import { resolveDomainProfile } from "../../core/profiles/domainProfiles";
import {
  type PromptOption,
  DOCUMENT_GENERATION_GUIDANCE,
  type GenerationPromptBindings,
  generationPromptBindings,
  renderSystemPromptTemplate,
  renderReferencePromptTemplate,
  promptTemplate,
  promptOptions
} from "../../core/prompts/prompt";

export interface GenerationPromptBuildResult {
  config: GenerationPromptConfigRecord;
  allowedCodeEntityIds: string[];
  allowedCodeEntityAliases: CodeEntityPromptAlias[];
  allowedCodeEntities: CodeEntityRecord[];
  allowedDiagramIds: string[];
  allowedDiagramComponentIds: string[];
}

function evidencePromptRepresentation(
  record: CodeEntityRecord,
  domainProfileId: BuiltInDomainProfileId
): string {
  if (domainProfileId === "source-code") return new CodeEntity(record).prompt_str();
  const evidence = resolveDomainProfile(domainProfileId).evidenceSchema.fromCodeEntity(record);
  const ranges = evidence.anchors.map((range) => {
    const symbol = range.symbol ? ` (${range.symbol})` : "";
    return `- ${range.path}:${range.startLine}-${range.endLine}${symbol}`;
  }).join("\n");
  return `Evidence @entity/${evidence.handle}\nLabel: ${evidence.label}\nKind: ${evidence.kind}\nSummary: ${evidence.summary}\nDocument ranges:\n${ranges}`;
}

export const DEFAULT_AUXILIARY_INSTRUCTIONS = {
  "call-graph": "Generate an ASCII call graph based on the foundation diagram.",
  "dir-view": "Generate an ASCII directory view based on the foundation diagram."
} as const;

export function defaultGenerationInstruction(targetKind: GenerationTargetKind): string {
  return targetKind === "call-graph" || targetKind === "dir-view"
    ? DEFAULT_AUXILIARY_INSTRUCTIONS[targetKind]
    : "";
}

export function createGenerationPromptConfig(input: {
  id: string;
  diagramSet: DiagramSetRecord;
  codeEntities: CodeEntitiesSetRecord;
  diagrams: DiagramRecord[];
  components: DiagramComponentRecord[];
  outputKind: GenerationOutputKind;
  viewKind?: DiagramViewKind;
  modelId: DiagramModelId;
  profile: SystemPromptTemplateRecord;
  /** Named prompts selected by the workflow. Defaults to the standard target bindings. */
  promptBindings?: GenerationPromptBindings;
  instruction: string;
  runReferencePrompt?: boolean;
  referencePrompt?: string;
  selectedCodeEntityIds: string[];
  referenceSelections?: GenerationReferenceSelection[];
  referencePromptSelections?: GenerationReferenceSelection[];
  derivation?: GenerationDerivationRecord;
  createdAt: string;
  domainProfileId?: BuiltInDomainProfileId;
}): GenerationPromptBuildResult {
  if (input.codeEntities.status !== "finalized") {
    throw new Error("CodeEntitiesSet must be finalized before generation");
  }
  const entitiesById = new Map(input.codeEntities.entities.map((entity) => [entity.id, entity]));
  const allDiagramsById = new Map(input.diagrams.map((diagram) => [diagram.id, diagram]));
  const activeDiagrams = input.diagrams.filter((diagram) => !isDiagramArchived(diagram));
  const diagramsById = new Map(activeDiagrams.map((diagram) => [diagram.id, diagram]));
  const allComponentsById = new Map(input.components.map((component) => [component.id, component]));
  const activeComponents = input.components.filter((component) => !isDiagramComponentArchived(component));
  const componentsById = new Map(activeComponents.map((component) => [component.id, component]));
  const viewKind = input.outputKind === "diagram" ? input.viewKind ?? "diagram" : undefined;
  const targetKind: GenerationTargetKind = input.outputKind === "diagram-component"
    ? "diagram-component"
    : viewKind ?? "diagram";
  const promptBindings = input.promptBindings ?? generationPromptBindings(targetKind);
  const domainProfileId = input.domainProfileId ?? "source-code";
  const domainProfile = resolveDomainProfile(domainProfileId);
  const evidenceSchema = domainProfile.evidenceSchema;
  const documentMode = domainProfileId === "document";
  const evidenceCollectionLabel = documentMode ? evidenceSchema.label : "CodeEntities";
  const systemPromptTemplate = promptTemplate(input.profile, promptBindings.system);
  const referencePromptTemplate = promptBindings.reference
    ? promptTemplate(input.profile, promptBindings.reference)
    : undefined;
  const mappingPromptTemplate = promptTemplate(input.profile, promptBindings.mapping);
  const auxiliary = viewKind === "call-graph" || viewKind === "dir-view";
  let foundationDiagram: DiagramRecord | undefined;
  let companionCallGraph: DiagramRecord | undefined;
  if (auxiliary) {
    const foundationId = input.diagramSet.featuredViewIds.diagram;
    foundationDiagram = foundationId ? diagramsById.get(foundationId) : undefined;
    if (!foundationDiagram || foundationDiagram.viewKind !== "diagram") {
      throw new Error("settle a main Diagram before generating auxiliary views");
    }
    if (viewKind === "dir-view") {
      const callGraphId = input.diagramSet.featuredViewIds["call-graph"];
      companionCallGraph = callGraphId ? diagramsById.get(callGraphId) : undefined;
      if (!companionCallGraph || companionCallGraph.viewKind !== "call-graph") {
        throw new Error("settle a Call Graph before generating a Directory View");
      }
    }
    for (const id of [...new Set([
      ...foundationDiagram.codeEntityIds,
      ...(companionCallGraph?.codeEntityIds ?? [])
    ])]) {
      if (!entitiesById.has(id)) {
        throw new Error(`immutable auxiliary context references unavailable CodeEntity: ${id}`);
      }
    }
  }
  const options = promptOptions(input.codeEntities, input.diagrams, input.components);
  const optionsByTypedToken = new Map(options.map((option) => [option.token.toLowerCase(), option]));
  const optionsByHandle = new Map<string, PromptOption[]>();
  for (const option of options) {
    const entries = optionsByHandle.get(option.handle.toLowerCase()) ?? [];
    entries.push(option);
    optionsByHandle.set(option.handle.toLowerCase(), entries);
  }
  const selectionMap = (selections: GenerationReferenceSelection[]) => {
    const byToken = new Map<string, GenerationReferenceSelection>();
    for (const selection of selections) {
      const token = selection.token.toLowerCase();
      const existing = byToken.get(token);
      if (existing && (existing.kind !== selection.kind
        || existing.targetId !== selection.targetId
        || existing.included !== selection.included)) {
        throw new Error(`conflicting reference selection for ${selection.token}`);
      }
      byToken.set(token, selection);
    }
    return byToken;
  };

  const selected = [...new Set(auxiliary
    ? [...foundationDiagram!.codeEntityIds, ...(companionCallGraph?.codeEntityIds ?? [])]
    : input.selectedCodeEntityIds)];
  for (const id of selected) {
    if (!entitiesById.has(id)) throw new Error(`unknown selected CodeEntity: ${id}`);
  }

  const mentionPattern = /@(entity|diagram|component)\/([a-z0-9][a-z0-9-]*)|@([a-z0-9][a-z0-9-]*)/gi;
  const resolveMentions = (
    instruction: string,
    selections: GenerationReferenceSelection[]
  ): {
    references: Array<Omit<GenerationPromptReference, "promptRepresentation">>;
    omittedReferences: PromptReference[];
    seenReferences: Set<string>;
  } => {
    const selectionsByToken = selectionMap(selections);
    const references: Array<Omit<GenerationPromptReference, "promptRepresentation">> = [];
    const omittedReferences: PromptReference[] = [];
    const seenReferences = new Set<string>();
    for (const match of instruction.matchAll(mentionPattern)) {
      const token = match[0];
      const typed = match[1] && match[2]
        ? optionsByTypedToken.get(`@${match[1].toLowerCase()}/${match[2].toLowerCase()}`)
        : undefined;
      const bare = match[3] ? optionsByHandle.get(match[3].toLowerCase()) ?? [] : [];
      if (!typed && bare.length > 1) {
        throw new Error(`ambiguous reference ${token}; use @entity/, @diagram/, or @component/`);
      }
      const selection = selectionsByToken.get(token.toLowerCase());
      let selectedOption: PromptOption | undefined;
      if (selection) {
        const typedKind = match[1] === "component" ? "diagram-component" : match[1];
        if (typedKind && typedKind !== selection.kind) {
          throw new Error(`reference selection kind does not match ${token}`);
        }
        if (selection.kind === "code-entity") {
          const entity = entitiesById.get(selection.targetId);
          if (entity) selectedOption = {
            kind: "code-entity",
            id: entity.id,
            handle: entity.handle,
            label: entity.label,
            token,
            ...(entity.origin ? { origin: entity.origin } : {})
          };
        } else if (selection.kind === "diagram") {
          const diagram = allDiagramsById.get(selection.targetId);
          if (diagram && (!selection.included || !isDiagramArchived(diagram))) selectedOption = {
            kind: "diagram",
            id: diagram.id,
            handle: diagram.handle,
            label: diagram.name,
            token,
            ...(diagram.recordOrigin ? { origin: diagram.recordOrigin } : {})
          };
        } else {
          const component = allComponentsById.get(selection.targetId);
          if (component && (!selection.included || !isDiagramComponentArchived(component))) selectedOption = {
            kind: "diagram-component",
            id: component.id,
            handle: component.handle,
            label: component.name,
            token,
            ...(component.recordOrigin ? { origin: component.recordOrigin } : {})
          };
        }
        if (!selectedOption) throw new Error(`unavailable prompt reference: ${token}`);
      }
      const option = selectedOption ?? typed ?? bare[0];
      if (!option) throw new Error(`unknown prompt reference: ${token}`);
      const key = `${option.kind}:${option.id}`;
      if (seenReferences.has(key)) continue;
      seenReferences.add(key);
      const reference = {
        kind: option.kind,
        targetId: option.id,
        ...(option.origin ? { origin: option.origin } : {}),
        token,
        handle: option.handle
      };
      if (selection?.included === false) omittedReferences.push(reference);
      else references.push(reference);
    }
    return { references, omittedReferences, seenReferences };
  };
  const initialMentions = resolveMentions(input.instruction, input.referenceSelections ?? []);
  const references = initialMentions.references;
  const omittedReferences = initialMentions.omittedReferences;
  const seenReferences = initialMentions.seenReferences;
  const followUpMentions = resolveMentions(
    input.referencePrompt ?? "",
    input.referencePromptSelections ?? []
  );
  const systemTemplateMentions = resolveMentions(systemPromptTemplate, []);
  const shouldRunReferencePrompt = input.runReferencePrompt === true
    || Boolean(input.referencePrompt?.trim());
  if (shouldRunReferencePrompt && !referencePromptTemplate) {
    throw new Error("the selected prompt workflow has no reference prompt binding");
  }
  const referenceTemplateMentions = resolveMentions(
    shouldRunReferencePrompt ? referencePromptTemplate ?? "" : "",
    []
  );
  const uniqueReferences = (
    values: Array<Omit<GenerationPromptReference, "promptRepresentation">>
  ) => [...new Map(values.map((reference) => [
    `${reference.kind}:${reference.targetId}`,
    reference
  ])).values()];
  const followUpReferences = uniqueReferences([
    ...followUpMentions.references,
    ...referenceTemplateMentions.references
  ]);

  if (auxiliary) {
    const immutableDiagrams = [foundationDiagram!, companionCallGraph]
      .filter((diagram): diagram is DiagramRecord => Boolean(diagram));
    for (const diagram of [...immutableDiagrams].reverse()) {
      const key = `diagram:${diagram.id}`;
      const omittedIndex = omittedReferences.findIndex((reference) => (
        reference.kind === "diagram" && reference.targetId === diagram.id
      ));
      if (omittedIndex >= 0) omittedReferences.splice(omittedIndex, 1);
      if (!references.some((reference) => (
        reference.kind === "diagram" && reference.targetId === diagram.id
      ))) {
        seenReferences.add(key);
        references.unshift({
          kind: "diagram",
          targetId: diagram.id,
          ...(diagram.recordOrigin ? { origin: diagram.recordOrigin } : {}),
          token: `@diagram/${diagram.handle}`,
          handle: diagram.handle
        });
      }
    }
  }

  const selectedFromReferences = references
    .filter((reference) => reference.kind === "code-entity")
    .map((reference) => reference.targetId);
  const referencedDiagrams = references
    .filter((reference) => reference.kind === "diagram")
    .map((reference) => diagramsById.get(reference.targetId))
    .filter((diagram): diagram is DiagramRecord => Boolean(diagram));
  const referencedComponents = references
    .filter((reference) => reference.kind === "diagram-component")
    .map((reference) => componentsById.get(reference.targetId))
    .filter((component): component is DiagramComponentRecord => Boolean(component));
  const followUpCodeEntityIds = followUpReferences
    .filter((reference) => reference.kind === "code-entity")
    .map((reference) => reference.targetId);
  const followUpReferencedDiagrams = followUpReferences
    .filter((reference) => reference.kind === "diagram")
    .map((reference) => diagramsById.get(reference.targetId))
    .filter((diagram): diagram is DiagramRecord => Boolean(diagram));
  const followUpReferencedComponents = followUpReferences
    .filter((reference) => reference.kind === "diagram-component")
    .map((reference) => componentsById.get(reference.targetId))
    .filter((component): component is DiagramComponentRecord => Boolean(component));
  const allowedCodeEntityIds = [...new Set([
    ...selected,
    ...selectedFromReferences,
    ...followUpCodeEntityIds,
    ...systemTemplateMentions.references
      .filter((reference) => reference.kind === "code-entity")
      .map((reference) => reference.targetId),
    ...referencedDiagrams.flatMap((diagram) => diagram.codeEntityIds),
    ...referencedComponents.flatMap((component) => component.codeEntityIds),
    ...systemTemplateMentions.references.flatMap((reference) => (
      reference.kind === "diagram"
        ? diagramsById.get(reference.targetId)?.codeEntityIds ?? []
        : reference.kind === "diagram-component"
          ? componentsById.get(reference.targetId)?.codeEntityIds ?? []
          : []
    ))
  ])];
  const promptCodeEntityIds = [...new Set([
    ...allowedCodeEntityIds,
    ...followUpReferencedDiagrams.flatMap((diagram) => diagram.codeEntityIds),
    ...followUpReferencedComponents.flatMap((component) => component.codeEntityIds)
  ])];
  const promptCodeEntities = promptCodeEntityIds.map((id) => {
    const entity = entitiesById.get(id);
    if (!entity) throw new Error(`referenced artifact uses unavailable CodeEntity: ${id}`);
    return entity;
  });
  const promptCodeEntityAliases = createCodeEntityPromptAliases(promptCodeEntities);
  const allowedIds = new Set(allowedCodeEntityIds);
  const allowedCodeEntityAliases = promptCodeEntityAliases.filter(({ id }) => allowedIds.has(id));
  const codeEntityAliasesById = new Map(
    promptCodeEntityAliases.map(({ id, alias }) => [id, alias])
  );
  const renderReferences = (
    values: Array<Omit<GenerationPromptReference, "promptRepresentation">>
  ): GenerationPromptReference[] => values.map((reference) => ({
      ...reference,
      promptRepresentation: reference.kind === "code-entity"
        ? evidencePromptRepresentation(entitiesById.get(reference.targetId)!, domainProfileId)
        : reference.kind === "diagram"
          ? new Diagram(diagramsById.get(reference.targetId)!).prompt_str(codeEntityAliasesById)
          : new DiagramComponent(componentsById.get(reference.targetId)!).prompt_str(codeEntityAliasesById)
    }));
  const renderedReferences = renderReferences(references);
  const renderedFollowUpReferences = renderReferences(followUpReferences);
  const renderedSystemTemplateReferences = renderReferences(systemTemplateMentions.references);

  const selectedBlocks = [...new Set([...selected, ...selectedFromReferences])]
    .map((id) => evidencePromptRepresentation(entitiesById.get(id)!, domainProfileId));
  const diagramBlocks = renderedReferences
    .filter((reference) => reference.kind === "diagram")
    .map((reference) => reference.promptRepresentation);
  const componentBlocks = renderedReferences
    .filter((reference) => reference.kind === "diagram-component")
    .map((reference) => reference.promptRepresentation);
  const directoryPaths = [...new Set(allowedCodeEntityIds.flatMap((id) => (
    entitiesById.get(id)?.sourceRanges.map((range) => range.path) ?? []
  )))].sort();
  const outputInstruction = documentMode
    ? input.outputKind === "diagram-component"
      ? "Generate one reusable document-grounded DiagramComponent. Preserve the meaning supported by the supplied evidence and return only the component. Use only 7-bit ASCII."
      : viewKind === "call-graph"
        ? "Generate one document-grounded hierarchical tree. Represent claims, events, chronology, and relationships supported by the supplied evidence. Use only 7-bit ASCII. Map visible semantic nodes to the supplied evidence aliases; never print persisted identifiers."
        : "Generate one document-grounded diagram. Use only 7-bit ASCII. Map every evidence-backed label to a supplied evidence alias in submission metadata, but do not print identifiers."
    : input.outputKind === "diagram-component"
    ? "Generate one reusable DiagramComponent for use inside a broader ASCII Diagram. Explore a distinct version of the supplied component or context. Preserve source-backed meaning and return only the component. Use only 7-bit ASCII."
    : viewKind === "call-graph"
      ? "Generate one call graph. Represent source-backed calls, branches, joins, and entry points. Use only 7-bit ASCII. Map nodes with readable supplied CodeEntity aliases such as [entity-handle]; never print persisted identifiers."
      : viewKind === "dir-view"
        ? "Generate one directory view. Use only the supplied repository paths, include only relevant branches, and annotate files with source-backed responsibilities. Use only 7-bit ASCII."
        : "Generate one architecture diagram. Use only 7-bit ASCII. Map every code label to a supplied CodeEntity alias in submission metadata, but do not print identifiers in the ASCII.";
  let derivation: GenerationDerivationRecord | undefined;
  if (input.derivation) {
    const sourceExists = input.derivation.sourceArtifactKind === "diagram"
      ? allDiagramsById.has(input.derivation.sourceArtifactId)
      : allComponentsById.has(input.derivation.sourceArtifactId);
    if (!sourceExists) throw new Error(`unknown derivation source: ${input.derivation.sourceArtifactId}`);
    const sourceIncluded = references.some((reference) => (
      reference.kind === input.derivation!.sourceArtifactKind
      && reference.targetId === input.derivation!.sourceArtifactId
    ));
    if (sourceIncluded) {
      derivation = {
        ...input.derivation,
        promptCorrection: input.derivation.promptCorrection.trim()
      };
    }
  }
  const immutableDiagramIds = new Set([
    foundationDiagram?.id,
    companionCallGraph?.id
  ].filter((id): id is string => Boolean(id)));
  const auxiliaryDiagramBlocks = renderedReferences
    .filter((reference) => reference.kind === "diagram" && !immutableDiagramIds.has(reference.targetId))
    .map((reference) => reference.promptRepresentation);
  const renderedContextPrompt = auxiliary ? [
    `DiagramSet: ${input.diagramSet.name}`,
    `Immutable foundation Diagram:\n${new Diagram(foundationDiagram!).prompt_str(codeEntityAliasesById)}`,
    ...(companionCallGraph
      ? [`Immutable companion Call Graph:\n${new Diagram(companionCallGraph).prompt_str(codeEntityAliasesById)}`]
      : []),
    `Immutable ${evidenceCollectionLabel}:\n${selectedBlocks.join("\n\n") || "none"}`,
    ...(auxiliaryDiagramBlocks.length
      ? [`Additional referenced Diagrams:\n${auxiliaryDiagramBlocks.join("\n\n")}`]
      : []),
    ...(componentBlocks.length
      ? [`Referenced DiagramComponents:\n${componentBlocks.join("\n\n")}`]
      : []),
    ...(viewKind === "dir-view"
      ? [`Immutable repository path inventory:\n${directoryPaths.map((path) => `- ${path}`).join("\n") || "none"}`]
      : []),
    `User instruction:\n${input.instruction.trim() || (documentMode ? "Create a clear visual representation from the supplied evidence." : defaultGenerationInstruction(viewKind!))}`
  ].join("\n\n") : [
    `DiagramSet: ${input.diagramSet.name}`,
    `Original request: ${input.diagramSet.initialPrompt || "none"}`,
    `User instruction:\n${input.instruction.trim() || (documentMode ? "Create a clear visual representation from the selected evidence." : "Create a clear diagram from the selected code entities.")}`,
    `Selected ${evidenceCollectionLabel}:\n${selectedBlocks.join("\n\n") || "none"}`,
    `Referenced Diagrams:\n${diagramBlocks.join("\n\n") || "none"}`,
    `Referenced DiagramComponents:\n${componentBlocks.join("\n\n") || "none"}`,
    outputInstruction
  ].join("\n\n");
  const referenceInstruction = input.referencePrompt?.trim() ?? "";
  const referenceContext = renderedFollowUpReferences
    .map((reference) => reference.promptRepresentation)
    .join("\n\n");
  const renderedReferencePrompt = shouldRunReferencePrompt
    ? renderReferencePromptTemplate({
        template: referencePromptTemplate!,
        targetKind,
        instruction: referenceInstruction,
        referenceContext: referenceContext || "none"
      })
    : undefined;

  const config: GenerationPromptConfigRecord = {
    schemaVersion: SCHEMA_VERSION,
    id: input.id,
    diagramSetId: input.diagramSet.id,
    domainProfileId,
    outputKind: input.outputKind,
    ...(viewKind ? { viewKind } : {}),
    modelId: input.modelId,
    instruction: input.instruction,
    selectedCodeEntityIds: selected,
    references: renderedReferences,
    ...(omittedReferences.length > 0 ? { omittedReferences } : {}),
    ...(renderedReferencePrompt ? {
      referencePrompt: {
        templateVersion: 1,
        promptName: promptBindings.reference,
        instruction: referenceInstruction,
        references: renderedFollowUpReferences,
        ...(followUpMentions.omittedReferences.length > 0
          ? { omittedReferences: followUpMentions.omittedReferences }
          : {}),
        rendered: renderedReferencePrompt
      }
    } : {}),
    mappingPrompt: {
      templateVersion: 1,
      promptName: promptBindings.mapping,
      template: mappingPromptTemplate
    },
    ...(derivation ? { derivation } : {}),
    contextPrompt: { templateVersion: 1, rendered: renderedContextPrompt },
    systemPrompt: {
      templateId: "artifact-generation",
      templateVersion: 1,
      profileId: input.profile.id,
      profileVersion: input.profile.version,
      promptName: promptBindings.system,
      ...(renderedSystemTemplateReferences.length
        ? { references: renderedSystemTemplateReferences }
        : {}),
      rendered: renderSystemPromptTemplate([
        ...(documentMode ? [DOCUMENT_GENERATION_GUIDANCE] : []),
        systemPromptTemplate,
        ...(renderedSystemTemplateReferences.length ? [
          `Referenced artifacts requested by this system template:\n${renderedSystemTemplateReferences
            .map((reference) => reference.promptRepresentation)
            .join("\n\n")}`
        ] : [])
      ].join("\n\n"), targetKind)
    },
    createdAt: input.createdAt
  };
  return {
    config,
    allowedCodeEntityIds,
    allowedCodeEntityAliases,
    allowedCodeEntities: promptCodeEntities.filter((entity) => allowedIds.has(entity.id)),
    allowedDiagramIds: [...new Set([
      ...referencedDiagrams,
      ...followUpReferencedDiagrams,
      ...systemTemplateMentions.references
        .filter((reference) => reference.kind === "diagram")
        .map((reference) => diagramsById.get(reference.targetId))
        .filter((diagram): diagram is DiagramRecord => Boolean(diagram))
    ].map((diagram) => diagram.id))],
    allowedDiagramComponentIds: [...new Set([
      ...referencedComponents,
      ...followUpReferencedComponents,
      ...systemTemplateMentions.references
        .filter((reference) => reference.kind === "diagram-component")
        .map((reference) => componentsById.get(reference.targetId))
        .filter((component): component is DiagramComponentRecord => Boolean(component))
    ].map((component) => component.id))]
  };
}
