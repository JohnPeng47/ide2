import {
  CodeEntity,
  Diagram,
  DiagramComponent,
  SCHEMA_VERSION,
  isDiagramComponentArchived,
  isDiagramArchived,
  type CodeEntitiesSetRecord,
  type CodeEntityPromptTemplateRecord,
  type DiagramModelId,
  type DiagramViewKind,
  type DiagramRecord,
  type DiagramComponentRecord,
  type DiagramSetRecord,
  type GenerationOutputKind,
  type GenerationTargetKind,
  type GenerationDerivationRecord,
  type GenerationPromptConfigRecord,
  type GenerationPromptProfileId,
  type GenerationPromptReference,
  type GenerationReferenceSelection,
  type SystemPromptTemplateRecord,
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

const DIAGRAM_BASE = "Generate exactly one architecture diagram from the supplied explicit context. Give it a compact, specific name, ideally two to five words; omit redundant words such as the DiagramSet name.";
const CALL_GRAPH_BASE = "Generate exactly one source-backed call graph from the supplied explicit context. Show invocation and control relationships, not general architecture or directory ownership. Give it a compact, specific name.";
const DIR_VIEW_BASE = "Generate exactly one source-backed ASCII directory view from the supplied explicit context. Show the relevant repository hierarchy and connect files to their responsibilities without inventing paths. Give it a compact, specific name.";
const COMPONENT_BASE = "Generate exactly one reusable DiagramComponent from the supplied explicit context. It is a fragment for a broader ASCII Diagram, not a complete diagram. Give it a compact, specific name.";
const DIAGRAM_FINISH = "Never modify files. Use 7-bit ASCII only and finish through {{submissionTool}}.";
const COMPONENT_FINISH = "Never modify files. Use 7-bit ASCII only and finish through {{submissionTool}}.";

export const DEFAULT_AUXILIARY_INSTRUCTIONS = {
  "call-graph": "Generate an ASCII call graph based on the foundation diagram.",
  "dir-view": "Generate an ASCII directory view based on the foundation diagram."
} as const;

export function defaultGenerationInstruction(targetKind: GenerationTargetKind): string {
  return targetKind === "call-graph" || targetKind === "dir-view"
    ? DEFAULT_AUXILIARY_INSTRUCTIONS[targetKind]
    : "";
}

export const DEFAULT_CODE_ENTITY_IDENTIFICATION_CRITERIA = `## Entity significance

A useful CodeEntity is a diagram-relevant concept backed by repository source.
It represents State, an Interface / Data Struct, or an Operation and helps
explain the requested architecture, ownership, behavior, or data flow.

These categories are intentionally broad. A CodeEntity may cover multiple
related source ranges when they collectively implement one architectural
concept.

## Source grounding

Each CodeEntity has a concise label and summary, an appropriate source symbol,
and exact repo-relative source ranges. Its description reflects behavior
visible in those ranges without inventing responsibilities.

Strong candidates include declarations, interfaces, state boundaries, important
operations, control-flow boundaries, and transformations that connect the
requested diagram concepts.`;

export const DEFAULT_CODE_ENTITY_COMPACTION_CRITERIA = `## Source structure

A good compactedSource preserves declarations, important boundaries, calls,
validations, and data flow while omitting secondary implementation detail.

Low compaction retains most implementation detail. Medium preserves structure
and important operations. High keeps mainly declarations, boundaries, and
critical calls. Retained and collapsed sections form a continuous program:

    visible inputs -> compacted transformation -> visible consumers

A useful boundary leaves setup values visible above and the code consuming the
compacted result visible below. If visible code consumes an unexplained value,
the boundary moves or more source remains visible.

## ASCII summaries

Each collapsed span is a concise, source-backed 7-bit ASCII data/control-flow
graph. It names important inputs, calls, branches, transformations, errors, and
the exact outputs made available to surrounding code.

This rendered presentation is the target shape:

      values = point.values
      camera_cfg = config["camera"]
      scenario = config["scenario"]

      body_to_camera = np.asarray(
          camera_cfg.get("body_to_camera", np.eye(3)), dtype=float
      ).reshape(3, 3)
      target_dir_c = _camera_ray_from_fov_fraction(camera_cfg, values)

      // [Lines 388-405 | 18 lines compacted]
      //
      // select an orientation source and produce common frame outputs
      //   |
      //   +--[camera angles]--> camera_forward_w -> rotation_wc
      //   |                                          +--> los_w
      //   |                                          \\--> rotation_wb
      //   \\--[LOS angles]----> los_w -> rotation_wb -> camera_forward_w

      target_position_w = _array(scenario["target_origin_w"], length=3)
      pursuer_position_w = target_position_w - float(values["range_m"]) * los_w
      relative_velocity_w = values["forward_speed_mps"] * camera_forward_w

The UI adds the heading and comment prefixes shown in the example; only the
graph body belongs in a collapsed-comment value.

## Mapping requirements

Every graph line describing an operation, branch, transformation, error, or
output has a semantic node mapped to exact lines inside its collapsed section.
Blank and connector-only lines have no mapping. Contextual references to
surrounding retained code do not extend node ranges outside the collapsed span.

All labels remain concise and source-backed. The server snapshots original
source after validating the submitted coordinates.`;

export const BUILT_IN_SYSTEM_PROMPT_TEMPLATES = [
  { id: "default", label: "Default", description: "Balanced architecture diagram generation.", diagram: "", callGraph: "", dirView: "", component: "Be creative." },
  { id: "structure-first", label: "Structure first", description: "Prioritize ownership, boundaries, and hierarchy.", diagram: "Emphasize ownership, boundaries, and hierarchy.", callGraph: "Group calls by their owning subsystem.", dirView: "Emphasize meaningful directory boundaries.", component: "Emphasize a reusable structural relationship." },
  { id: "flow-first", label: "Flow first", description: "Prioritize directional control and data flow.", diagram: "Emphasize directional control and data flow.", callGraph: "Emphasize the primary invocation path and branch points.", dirView: "Annotate files with concise data-flow responsibilities.", component: "Emphasize one clear input-to-output interaction." },
  { id: "compact", label: "Compact", description: "Prefer small, dense, composable layouts.", diagram: "Prefer a dense layout with minimal crossing edges.", callGraph: "Prefer a compact graph with minimal crossing edges.", dirView: "Collapse irrelevant directory branches.", component: "Prefer a small fragment that composes cleanly." }
] as const;

export function createBuiltInSystemPromptTemplates(createdAt: string): SystemPromptTemplateRecord[] {
  return BUILT_IN_SYSTEM_PROMPT_TEMPLATES.map((template) => ({
    schemaVersion: SCHEMA_VERSION,
    id: template.id,
    label: template.label,
    description: template.description,
    builtIn: true,
    version: 1,
    prompts: {
      diagram: [DIAGRAM_BASE, template.diagram, DIAGRAM_FINISH].filter(Boolean).join(" "),
      "call-graph": [CALL_GRAPH_BASE, template.callGraph, DIAGRAM_FINISH].filter(Boolean).join(" "),
      "dir-view": [DIR_VIEW_BASE, template.dirView, DIAGRAM_FINISH].filter(Boolean).join(" "),
      "diagram-component": [COMPONENT_BASE, template.component, COMPONENT_FINISH].filter(Boolean).join(" ")
    },
    createdAt,
    updatedAt: createdAt
  }));
}

export function createBuiltInCodeEntityPromptTemplates(
  createdAt: string
): CodeEntityPromptTemplateRecord[] {
  return [{
    schemaVersion: SCHEMA_VERSION,
    id: "default-code-entities",
    label: "Default Code Entities",
    description: "Source-backed entity identification and continuous source compaction.",
    builtIn: true,
    version: 1,
    prompts: {
      "code-entity-identification": DEFAULT_CODE_ENTITY_IDENTIFICATION_CRITERIA,
      "code-entity-compaction": DEFAULT_CODE_ENTITY_COMPACTION_CRITERIA
    },
    createdAt,
    updatedAt: createdAt
  }];
}

export function renderSystemPromptTemplate(
  template: string,
  targetKind: GenerationTargetKind
): string {
  const values: Record<string, string> = {
    outputKind: targetKind === "diagram-component"
      ? "DiagramComponent"
      : targetKind === "call-graph"
        ? "CallGraph"
        : targetKind === "dir-view"
          ? "DirectoryView"
          : "Diagram",
    submissionTool: targetKind === "diagram-component" ? "submit_diagram_component" : "submit_diagram"
  };
  const unknown = [...template.matchAll(/{{\s*([a-zA-Z][a-zA-Z0-9]*)\s*}}/g)]
    .map((match) => match[1])
    .filter((name) => values[name] === undefined);
  if (unknown.length) throw new Error(`unknown system prompt variable: {{${unknown[0]}}}`);
  return template.replace(/{{\s*([a-zA-Z][a-zA-Z0-9]*)\s*}}/g, (_match, name: string) => values[name]);
}

export function renderArtifactSystemPrompt(input: {
  outputKind: GenerationOutputKind;
  viewKind?: DiagramViewKind;
  template: SystemPromptTemplateRecord;
}): string {
  const targetKind: GenerationTargetKind = input.outputKind === "diagram-component"
    ? "diagram-component"
    : input.viewKind ?? "diagram";
  return renderSystemPromptTemplate(input.template.prompts[targetKind], targetKind);
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
  viewKind?: DiagramViewKind;
  modelId: DiagramModelId;
  profile: SystemPromptTemplateRecord;
  instruction: string;
  selectedCodeEntityIds: string[];
  referenceSelections?: GenerationReferenceSelection[];
  derivation?: GenerationDerivationRecord;
  createdAt: string;
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
  const auxiliary = viewKind === "call-graph" || viewKind === "dir-view";
  let foundationDiagram: DiagramRecord | undefined;
  let companionCallGraph: DiagramRecord | undefined;
  if (auxiliary) {
    const foundationId = input.diagramSet.featuredViewIds.diagram;
    foundationDiagram = foundationId ? diagramsById.get(foundationId) : undefined;
    if (!foundationDiagram || foundationDiagram.viewKind !== "diagram") {
      throw new Error("star a main Diagram before generating auxiliary views");
    }
    if (viewKind === "dir-view") {
      const callGraphId = input.diagramSet.featuredViewIds["call-graph"];
      companionCallGraph = callGraphId ? diagramsById.get(callGraphId) : undefined;
      if (!companionCallGraph || companionCallGraph.viewKind !== "call-graph") {
        throw new Error("star a Call Graph before generating a Directory View");
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
  const selectionsByToken = new Map<string, GenerationReferenceSelection>();
  for (const selection of input.referenceSelections ?? []) {
    const token = selection.token.toLowerCase();
    const existing = selectionsByToken.get(token);
    if (existing && (existing.kind !== selection.kind
      || existing.targetId !== selection.targetId
      || existing.included !== selection.included)) {
      throw new Error(`conflicting reference selection for ${selection.token}`);
    }
    selectionsByToken.set(token, selection);
  }

  const selected = [...new Set(auxiliary
    ? [...foundationDiagram!.codeEntityIds, ...(companionCallGraph?.codeEntityIds ?? [])]
    : input.selectedCodeEntityIds)];
  for (const id of selected) {
    if (!entitiesById.has(id)) throw new Error(`unknown selected CodeEntity: ${id}`);
  }

  const references: GenerationPromptReference[] = [];
  const omittedReferences: PromptReference[] = [];
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
          token
        };
      } else if (selection.kind === "diagram") {
        const diagram = allDiagramsById.get(selection.targetId);
        if (diagram && (!selection.included || !isDiagramArchived(diagram))) selectedOption = {
          kind: "diagram",
          id: diagram.id,
          handle: diagram.handle,
          label: diagram.name,
          token
        };
      } else {
        const component = allComponentsById.get(selection.targetId);
        if (component && (!selection.included || !isDiagramComponentArchived(component))) selectedOption = {
          kind: "diagram-component",
          id: component.id,
          handle: component.handle,
          label: component.name,
          token
        };
      }
      if (!selectedOption) throw new Error(`unavailable prompt reference: ${token}`);
    }
    const option = selectedOption ?? typed ?? bare[0];
    if (!option) throw new Error(`unknown prompt reference: ${token}`);
    const key = `${option.kind}:${option.id}`;
    if (seenReferences.has(key)) continue;
    seenReferences.add(key);
    if (selection?.included === false) {
      omittedReferences.push({
        kind: option.kind,
        targetId: option.id,
        token,
        handle: option.handle
      });
      continue;
    }
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
          token: `@diagram/${diagram.handle}`,
          handle: diagram.handle,
          promptRepresentation: new Diagram(diagram).prompt_str()
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
  const directoryPaths = [...new Set(allowedCodeEntityIds.flatMap((id) => (
    entitiesById.get(id)?.sourceRanges.map((range) => range.path) ?? []
  )))].sort();
  const outputInstruction = input.outputKind === "diagram-component"
    ? "Generate one reusable DiagramComponent for use inside a broader ASCII Diagram. Explore a distinct version of the supplied component or context. Preserve source-backed meaning and return only the component. Use only 7-bit ASCII."
    : viewKind === "call-graph"
      ? "Generate one call graph. Represent source-backed calls, branches, joins, and entry points. Use only 7-bit ASCII. Every code label must map to a supplied CodeEntity id."
      : viewKind === "dir-view"
        ? "Generate one directory view. Use only the supplied repository paths, include only relevant branches, and annotate files with source-backed responsibilities. Use only 7-bit ASCII."
        : "Generate one architecture diagram. Use only 7-bit ASCII. Every code label must map to one of the supplied CodeEntity ids.";
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
  const auxiliaryDiagramBlocks = references
    .filter((reference) => reference.kind === "diagram" && !immutableDiagramIds.has(reference.targetId))
    .map((reference) => reference.promptRepresentation);
  const renderedContextPrompt = auxiliary ? [
    `DiagramSet: ${input.diagramSet.name}`,
    `Immutable foundation Diagram:\n${new Diagram(foundationDiagram!).prompt_str()}`,
    ...(companionCallGraph
      ? [`Immutable companion Call Graph:\n${new Diagram(companionCallGraph).prompt_str()}`]
      : []),
    `Immutable CodeEntities:\n${selectedBlocks.join("\n\n") || "none"}`,
    ...(auxiliaryDiagramBlocks.length
      ? [`Additional referenced Diagrams:\n${auxiliaryDiagramBlocks.join("\n\n")}`]
      : []),
    ...(componentBlocks.length
      ? [`Referenced DiagramComponents:\n${componentBlocks.join("\n\n")}`]
      : []),
    ...(viewKind === "dir-view"
      ? [`Immutable repository path inventory:\n${directoryPaths.map((path) => `- ${path}`).join("\n") || "none"}`]
      : []),
    `User instruction:\n${input.instruction.trim() || defaultGenerationInstruction(viewKind!)}`
  ].join("\n\n") : [
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
    ...(viewKind ? { viewKind } : {}),
    modelId: input.modelId,
    instruction: input.instruction,
    selectedCodeEntityIds: selected,
    references,
    ...(omittedReferences.length > 0 ? { omittedReferences } : {}),
    ...(derivation ? { derivation } : {}),
    contextPrompt: { templateVersion: 1, rendered: renderedContextPrompt },
    systemPrompt: {
      templateId: "artifact-generation",
      templateVersion: 1,
      profileId: input.profile.id,
      profileVersion: input.profile.version,
      rendered: renderArtifactSystemPrompt({
        outputKind: input.outputKind,
        viewKind,
        template: input.profile
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
