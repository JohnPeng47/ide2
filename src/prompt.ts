import {
  CodeEntity,
  Diagram,
  DiagramComponent,
  SCHEMA_VERSION,
  isDiagramComponentArchived,
  isDiagramArchived,
  type CodeEntitiesSetRecord,
  type DiagramModelId,
  type DiagramRecord,
  type DiagramComponentRecord,
  type DiagramSetRecord,
  type GenerationOutputKind,
  type GenerationPromptConfigRecord,
  type GenerationPromptProfileId,
  type GenerationPromptReference,
  type PromptReference
} from "./domain";

export interface PromptOption {
  kind: PromptReference["kind"];
  id: string;
  handle: string;
  label: string;
  token: string;
}

export interface GenerationPromptBuildResult {
  config: GenerationPromptConfigRecord;
  allowedCodeEntityIds: string[];
  allowedDiagramIds: string[];
  allowedDiagramComponentIds: string[];
}

const PROFILE_DIRECTIVES: Record<GenerationPromptProfileId, {
  diagram: string;
  component: string;
}> = {
  default: {
    diagram: "",
    component: "Be creative."
  },
  structureFirst: {
    diagram: "Emphasize ownership, boundaries, and hierarchy.",
    component: "Emphasize a reusable structural relationship."
  },
  flowFirst: {
    diagram: "Emphasize directional control and data flow.",
    component: "Emphasize one clear input-to-output interaction."
  },
  compact: {
    diagram: "Prefer a dense layout with minimal crossing edges.",
    component: "Prefer a small fragment that composes cleanly."
  }
};

export function renderArtifactSystemPrompt(input: {
  outputKind: GenerationOutputKind;
  profileId: GenerationPromptProfileId;
}): string {
  const componentMode = input.outputKind === "diagram-component";
  const directive = PROFILE_DIRECTIVES[input.profileId][componentMode ? "component" : "diagram"];
  return [
    componentMode
      ? "Generate exactly one reusable DiagramComponent from the supplied explicit context. It is a fragment for a broader ASCII Diagram, not a complete diagram."
      : "Generate exactly one architecture diagram from the supplied explicit context.",
    componentMode
      ? "Give it a compact, specific name."
      : "Give it a compact, specific name, ideally two to five words; omit redundant words such as the DiagramSet name.",
    directive,
    componentMode
      ? "Never modify files. Use 7-bit ASCII only and finish through submit_diagram_component."
      : "Never modify files. Use 7-bit ASCII only and finish through submit_diagram."
  ].filter(Boolean).join(" ");
}

export function promptOptions(
  codeEntities: CodeEntitiesSetRecord,
  diagrams: DiagramRecord[],
  components: DiagramComponentRecord[]
): PromptOption[] {
  return [
    ...codeEntities.entities.map((entity) => ({
      kind: "code-entity" as const,
      id: entity.id,
      handle: entity.handle,
      label: entity.label,
      token: `@entity/${entity.handle}`
    })),
    ...diagrams.filter((diagram) => !isDiagramArchived(diagram)).map((diagram) => ({
      kind: "diagram" as const,
      id: diagram.id,
      handle: diagram.handle,
      label: diagram.name,
      token: `@diagram/${diagram.handle}`
    })),
    ...components.filter((component) => !isDiagramComponentArchived(component)).map((component) => ({
      kind: "diagram-component" as const,
      id: component.id,
      handle: component.handle,
      label: component.name,
      token: `@component/${component.handle}`
    }))
  ];
}

export function createGenerationPromptConfig(input: {
  id: string;
  diagramSet: DiagramSetRecord;
  codeEntities: CodeEntitiesSetRecord;
  diagrams: DiagramRecord[];
  components: DiagramComponentRecord[];
  outputKind: GenerationOutputKind;
  modelId: DiagramModelId;
  profileId: GenerationPromptProfileId;
  instruction: string;
  selectedCodeEntityIds: string[];
  createdAt: string;
}): GenerationPromptBuildResult {
  if (input.codeEntities.status !== "finalized") {
    throw new Error("CodeEntitiesSet must be finalized before generation");
  }
  const entitiesById = new Map(input.codeEntities.entities.map((entity) => [entity.id, entity]));
  const activeDiagrams = input.diagrams.filter((diagram) => !isDiagramArchived(diagram));
  const diagramsById = new Map(activeDiagrams.map((diagram) => [diagram.id, diagram]));
  const activeComponents = input.components.filter((component) => !isDiagramComponentArchived(component));
  const componentsById = new Map(activeComponents.map((component) => [component.id, component]));
  const options = promptOptions(input.codeEntities, input.diagrams, input.components);
  const optionsByTypedToken = new Map(options.map((option) => [option.token.toLowerCase(), option]));
  const optionsByHandle = new Map<string, PromptOption[]>();
  for (const option of options) {
    const entries = optionsByHandle.get(option.handle.toLowerCase()) ?? [];
    entries.push(option);
    optionsByHandle.set(option.handle.toLowerCase(), entries);
  }

  const selected = [...new Set(input.selectedCodeEntityIds)];
  for (const id of selected) {
    if (!entitiesById.has(id)) throw new Error(`unknown selected CodeEntity: ${id}`);
  }

  const references: GenerationPromptReference[] = [];
  const seenReferences = new Set<string>();
  const mentionPattern = /@(entity|diagram|component)\/([a-z0-9][a-z0-9-]*)|@([a-z0-9][a-z0-9-]*)/gi;
  for (const match of input.instruction.matchAll(mentionPattern)) {
    const token = match[0];
    const typed = match[1] && match[2]
      ? optionsByTypedToken.get(`@${match[1].toLowerCase()}/${match[2].toLowerCase()}`)
      : undefined;
    const bare = match[3] ? optionsByHandle.get(match[3].toLowerCase()) ?? [] : [];
    if (!typed && bare.length > 1) {
      throw new Error(`ambiguous reference ${token}; use @entity/, @diagram/, or @component/`);
    }
    const option = typed ?? bare[0];
    if (!option) throw new Error(`unknown prompt reference: ${token}`);
    const key = `${option.kind}:${option.id}`;
    if (seenReferences.has(key)) continue;
    seenReferences.add(key);
    const promptRepresentation = option.kind === "code-entity"
      ? new CodeEntity(entitiesById.get(option.id)!).prompt_str()
      : option.kind === "diagram"
        ? new Diagram(diagramsById.get(option.id)!).prompt_str()
        : new DiagramComponent(componentsById.get(option.id)!).prompt_str();
    references.push({
      kind: option.kind,
      targetId: option.id,
      token,
      handle: option.handle,
      promptRepresentation
    });
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
  const allowedCodeEntityIds = [...new Set([
    ...selected,
    ...selectedFromReferences,
    ...referencedDiagrams.flatMap((diagram) => diagram.codeEntityIds),
    ...referencedComponents.flatMap((component) => component.codeEntityIds)
  ])];

  const selectedBlocks = [...new Set([...selected, ...selectedFromReferences])]
    .map((id) => new CodeEntity(entitiesById.get(id)!).prompt_str());
  const diagramBlocks = references
    .filter((reference) => reference.kind === "diagram")
    .map((reference) => reference.promptRepresentation);
  const componentBlocks = references
    .filter((reference) => reference.kind === "diagram-component")
    .map((reference) => reference.promptRepresentation);
  const outputInstruction = input.outputKind === "diagram-component"
    ? "Generate one reusable DiagramComponent for use inside a broader ASCII Diagram. Explore a distinct version of the supplied component or context. Be creative, preserve source-backed meaning, and return only the component, not a complete diagram. Use only 7-bit ASCII."
    : "Generate one architecture diagram. Use only 7-bit ASCII. Every code label must map to one of the supplied CodeEntity ids.";
  const renderedContextPrompt = [
    `DiagramSet: ${input.diagramSet.name}`,
    `Original request: ${input.diagramSet.initialPrompt || "none"}`,
    `User instruction:\n${input.instruction.trim() || "Create a clear diagram from the selected code entities."}`,
    `Selected CodeEntities:\n${selectedBlocks.join("\n\n") || "none"}`,
    `Referenced Diagrams:\n${diagramBlocks.join("\n\n") || "none"}`,
    `Referenced DiagramComponents:\n${componentBlocks.join("\n\n") || "none"}`,
    outputInstruction
  ].join("\n\n");

  const config: GenerationPromptConfigRecord = {
    schemaVersion: SCHEMA_VERSION,
    id: input.id,
    diagramSetId: input.diagramSet.id,
    outputKind: input.outputKind,
    modelId: input.modelId,
    instruction: input.instruction,
    selectedCodeEntityIds: selected,
    references,
    contextPrompt: { templateVersion: 1, rendered: renderedContextPrompt },
    systemPrompt: {
      templateId: "artifact-generation",
      templateVersion: 1,
      profileId: input.profileId,
      profileVersion: 1,
      rendered: renderArtifactSystemPrompt({
        outputKind: input.outputKind,
        profileId: input.profileId
      })
    },
    createdAt: input.createdAt
  };
  return {
    config,
    allowedCodeEntityIds,
    allowedDiagramIds: referencedDiagrams.map((diagram) => diagram.id),
    allowedDiagramComponentIds: referencedComponents.map((component) => component.id)
  };
}
