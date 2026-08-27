import {
  CodeEntity,
  Diagram,
  DiagramComponent,
  SCHEMA_VERSION,
  createCodeEntityPromptAliases,
  isDiagramComponentArchived,
  isDiagramArchived,
  type CodeEntitiesSetRecord,
  type CodeEntityPromptAlias,
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
  type PromptTemplateVariable,
  type SystemPromptTemplateRecord,
  type PromptReference
} from "./domain";

export interface PromptOption {
  kind: PromptReference["kind"];
  id: string;
  handle: string;
  label: string;
  token: string;
  origin?: PromptReference["origin"];
}

export interface GenerationPromptBuildResult {
  config: GenerationPromptConfigRecord;
  allowedCodeEntityIds: string[];
  allowedCodeEntityAliases: CodeEntityPromptAlias[];
  allowedDiagramIds: string[];
  allowedDiagramComponentIds: string[];
}

const DIAGRAM_BASE = "Generate exactly one architecture diagram from the supplied explicit context. Give it a compact, specific name, ideally two to five words; omit redundant words such as the DiagramSet name.";
const CALL_GRAPH_BASE = "Generate exactly one source-backed call graph from the supplied explicit context. Show invocation and control relationships, not general architecture or directory ownership. Give it a compact, specific name.";
const DIR_VIEW_BASE = "Generate exactly one source-backed ASCII directory view from the supplied explicit context. Show the relevant repository hierarchy and connect files to their responsibilities without inventing paths. Give it a compact, specific name.";
const COMPONENT_BASE = "Generate exactly one reusable DiagramComponent from the supplied explicit context. It is a fragment for a broader ASCII Diagram, not a complete diagram. Give it a compact, specific name.";
const DIAGRAM_FINISH = "Never modify files. Use 7-bit ASCII only and finish through {{submissionTool}}.";
const COMPONENT_FINISH = "Never modify files. Use 7-bit ASCII only and finish through {{submissionTool}}.";
export const DEFAULT_REFERENCE_FOLLOW_UP_PROMPT = `Regenerate the complete {{outputKind}} you submitted in the previous turn.

Follow this reference instruction:
{{referenceInstruction}}

Reference context:
{{referenceContext}}

Use referenced artifacts as visual style examples. Preserve the previous candidate's source-backed meaning, relationships, and CodeEntity coverage. Adopt visual grammar such as box shapes, connector style, spacing, density, grouping, and label placement, but do not copy unrelated labels, concepts, or repository-specific content. Return a complete replacement using 7-bit ASCII and end this turn by calling {{submissionTool}} exactly once.`;

export const PROMPT_TEMPLATE_VARIABLE_DEFINITIONS: Record<PromptTemplateVariable, {
  description: string;
  source: "computed" | "runtime";
}> = {
  outputKind: {
    description: "Display name for the artifact type selected in this template tab.",
    source: "computed"
  },
  submissionTool: {
    description: "Tool name inserted into prompt text; this does not rename the registered agent tool.",
    source: "computed"
  },
  referenceInstruction: {
    description: "Reference follow-up text entered on the generation screen.",
    source: "runtime"
  },
  referenceContext: {
    description: "Resolved @ references included with the follow-up turn.",
    source: "runtime"
  }
};

export const SYSTEM_PROMPT_TEMPLATE_VARIABLES: PromptTemplateVariable[] = [
  "outputKind",
  "submissionTool"
];
export const REFERENCE_PROMPT_TEMPLATE_VARIABLES: PromptTemplateVariable[] = [
  ...SYSTEM_PROMPT_TEMPLATE_VARIABLES,
  "referenceInstruction",
  "referenceContext"
];

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
    referencePrompts: {
      diagram: DEFAULT_REFERENCE_FOLLOW_UP_PROMPT,
      "call-graph": DEFAULT_REFERENCE_FOLLOW_UP_PROMPT,
      "dir-view": DEFAULT_REFERENCE_FOLLOW_UP_PROMPT,
      "diagram-component": DEFAULT_REFERENCE_FOLLOW_UP_PROMPT
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
  targetKind: GenerationTargetKind,
  variableOverrides: Partial<Record<PromptTemplateVariable, string>> = {}
): string {
  const values = resolvePromptTemplateVariableValues({
    targetKind,
    phase: "system",
    variableOverrides
  });
  return renderPromptTemplate(template, values);
}

export function resolvePromptTemplateVariableValues(input: {
  targetKind: GenerationTargetKind;
  phase: "system" | "reference";
  instruction?: string;
  referenceContext?: string;
  variableOverrides?: Partial<Record<PromptTemplateVariable, string>>;
}): Record<string, string> {
  const defaults: Record<PromptTemplateVariable, string> = {
    outputKind: input.targetKind === "diagram-component"
      ? "DiagramComponent"
      : input.targetKind === "call-graph"
        ? "CallGraph"
        : input.targetKind === "dir-view"
          ? "DirectoryView"
          : "Diagram",
    submissionTool: input.targetKind === "diagram-component"
      ? "submit_diagram_component"
      : "submit_diagram",
    referenceInstruction: input.instruction?.trim() ?? "Use @diagram/reference as the style reference.",
    referenceContext: input.referenceContext ?? "Diagram @diagram/reference\nASCII:\n+-- reference --+"
  };
  const names = input.phase === "reference"
    ? REFERENCE_PROMPT_TEMPLATE_VARIABLES
    : SYSTEM_PROMPT_TEMPLATE_VARIABLES;
  return Object.fromEntries(names.map((name) => [
    name,
    input.variableOverrides?.[name] ?? defaults[name]
  ]));
}

function renderPromptTemplate(template: string, values: Record<string, string>): string {
  const unknown = [...template.matchAll(/{{\s*([a-zA-Z][a-zA-Z0-9]*)\s*}}/g)]
    .map((match) => match[1])
    .filter((name) => values[name] === undefined);
  if (unknown.length) throw new Error(`unknown system prompt variable: {{${unknown[0]}}}`);
  return template.replace(/{{\s*([a-zA-Z][a-zA-Z0-9]*)\s*}}/g, (_match, name: string) => values[name]);
}

export function renderReferencePromptTemplate(input: {
  template: string;
  targetKind: GenerationTargetKind;
  instruction: string;
  referenceContext: string;
  variableOverrides?: Partial<Record<PromptTemplateVariable, string>>;
}): string {
  return renderPromptTemplate(input.template, resolvePromptTemplateVariableValues({
    targetKind: input.targetKind,
    phase: "reference",
    instruction: input.instruction,
    referenceContext: input.referenceContext,
    variableOverrides: input.variableOverrides
  }));
}

export function renderArtifactSystemPrompt(input: {
  outputKind: GenerationOutputKind;
  viewKind?: DiagramViewKind;
  template: SystemPromptTemplateRecord;
}): string {
  const targetKind: GenerationTargetKind = input.outputKind === "diagram-component"
    ? "diagram-component"
    : input.viewKind ?? "diagram";
  return renderSystemPromptTemplate(
    input.template.prompts[targetKind],
    targetKind,
    input.template.variableOverrides?.[targetKind]
  );
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
      token: `@entity/${entity.handle}`,
      ...(entity.origin ? { origin: entity.origin } : {})
    })),
    ...diagrams.filter((diagram) => !isDiagramArchived(diagram)).map((diagram) => ({
      kind: "diagram" as const,
      id: diagram.id,
      handle: diagram.handle,
      label: diagram.name,
      token: `@diagram/${diagram.handle}`,
      ...(diagram.recordOrigin ? { origin: diagram.recordOrigin } : {})
    })),
    ...components.filter((component) => !isDiagramComponentArchived(component)).map((component) => ({
      kind: "diagram-component" as const,
      id: component.id,
      handle: component.handle,
      label: component.name,
      token: `@component/${component.handle}`,
      ...(component.recordOrigin ? { origin: component.recordOrigin } : {})
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
  runReferencePrompt?: boolean;
  referencePrompt?: string;
  selectedCodeEntityIds: string[];
  referenceSelections?: GenerationReferenceSelection[];
  referencePromptSelections?: GenerationReferenceSelection[];
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
  const targetKind: GenerationTargetKind = input.outputKind === "diagram-component"
    ? "diagram-component"
    : viewKind ?? "diagram";
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
  const systemTemplateMentions = resolveMentions(input.profile.prompts[targetKind], []);
  const shouldRunReferencePrompt = input.runReferencePrompt === true
    || Boolean(input.referencePrompt?.trim());
  const referencePromptTemplate = input.profile.referencePrompts?.[targetKind]
    ?? DEFAULT_REFERENCE_FOLLOW_UP_PROMPT;
  const referenceTemplateMentions = resolveMentions(
    shouldRunReferencePrompt ? referencePromptTemplate : "",
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
        ? new CodeEntity(entitiesById.get(reference.targetId)!).prompt_str()
        : reference.kind === "diagram"
          ? new Diagram(diagramsById.get(reference.targetId)!).prompt_str(codeEntityAliasesById)
          : new DiagramComponent(componentsById.get(reference.targetId)!).prompt_str(codeEntityAliasesById)
    }));
  const renderedReferences = renderReferences(references);
  const renderedFollowUpReferences = renderReferences(followUpReferences);
  const renderedSystemTemplateReferences = renderReferences(systemTemplateMentions.references);

  const selectedBlocks = [...new Set([...selected, ...selectedFromReferences])]
    .map((id) => new CodeEntity(entitiesById.get(id)!).prompt_str());
  const diagramBlocks = renderedReferences
    .filter((reference) => reference.kind === "diagram")
    .map((reference) => reference.promptRepresentation);
  const componentBlocks = renderedReferences
    .filter((reference) => reference.kind === "diagram-component")
    .map((reference) => reference.promptRepresentation);
  const directoryPaths = [...new Set(allowedCodeEntityIds.flatMap((id) => (
    entitiesById.get(id)?.sourceRanges.map((range) => range.path) ?? []
  )))].sort();
  const outputInstruction = input.outputKind === "diagram-component"
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
  const referenceInstruction = input.referencePrompt?.trim() ?? "";
  const referenceContext = renderedFollowUpReferences
    .map((reference) => reference.promptRepresentation)
    .join("\n\n");
  const renderedReferencePrompt = shouldRunReferencePrompt
    ? [
        renderReferencePromptTemplate({
          template: referencePromptTemplate,
          targetKind,
          instruction: referenceInstruction,
          referenceContext: referenceContext || "none",
          variableOverrides: input.profile.variableOverrides?.[targetKind]
        }),
        ...(!/{{\s*referenceContext\s*}}/.test(referencePromptTemplate) && referenceContext
          ? [`Referenced artifacts requested by this reference template:\n${referenceContext}`]
          : [])
      ].join("\n\n")
    : undefined;

  const config: GenerationPromptConfigRecord = {
    schemaVersion: SCHEMA_VERSION,
    id: input.id,
    diagramSetId: input.diagramSet.id,
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
        instruction: referenceInstruction,
        references: renderedFollowUpReferences,
        ...(followUpMentions.omittedReferences.length > 0
          ? { omittedReferences: followUpMentions.omittedReferences }
          : {}),
        rendered: renderedReferencePrompt
      }
    } : {}),
    ...(derivation ? { derivation } : {}),
    contextPrompt: { templateVersion: 1, rendered: renderedContextPrompt },
    systemPrompt: {
      templateId: "artifact-generation",
      templateVersion: 1,
      profileId: input.profile.id,
      profileVersion: input.profile.version,
      ...(renderedSystemTemplateReferences.length
        ? { references: renderedSystemTemplateReferences }
        : {}),
      rendered: [
        renderArtifactSystemPrompt({
          outputKind: input.outputKind,
          viewKind,
          template: input.profile
        }),
        ...(renderedSystemTemplateReferences.length ? [
          `Referenced artifacts requested by this system template:\n${renderedSystemTemplateReferences
            .map((reference) => reference.promptRepresentation)
            .join("\n\n")}`
        ] : [])
      ].join("\n\n")
    },
    createdAt: input.createdAt
  };
  return {
    config,
    allowedCodeEntityIds,
    allowedCodeEntityAliases,
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
