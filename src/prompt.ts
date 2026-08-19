import {
  CodeEntity,
  Diagram,
  isDiagramArchived,
  type CodeEntitiesSetRecord,
  type DiagramRecord,
  type DiagramSetRecord,
  type PromptReference
} from "./domain";

export interface PromptOption {
  kind: PromptReference["kind"];
  id: string;
  handle: string;
  label: string;
  token: string;
}

export interface ResolvedGenerationPrompt {
  references: PromptReference[];
  selectedCodeEntityIds: string[];
  allowedCodeEntityIds: string[];
  resolvedPrompt: string;
}

export function promptOptions(
  codeEntities: CodeEntitiesSetRecord,
  diagrams: DiagramRecord[]
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
    }))
  ];
}

export function resolveGenerationPrompt(input: {
  diagramSet: DiagramSetRecord;
  codeEntities: CodeEntitiesSetRecord;
  diagrams: DiagramRecord[];
  userPrompt: string;
  selectedCodeEntityIds: string[];
}): ResolvedGenerationPrompt {
  if (input.codeEntities.status !== "finalized") {
    throw new Error("CodeEntitiesSet must be finalized before generation");
  }
  const entitiesById = new Map(input.codeEntities.entities.map((entity) => [entity.id, entity]));
  const activeDiagrams = input.diagrams.filter((diagram) => !isDiagramArchived(diagram));
  const diagramsById = new Map(activeDiagrams.map((diagram) => [diagram.id, diagram]));
  const options = promptOptions(input.codeEntities, input.diagrams);
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

  const references: PromptReference[] = [];
  const seenReferences = new Set<string>();
  const mentionPattern = /@(entity|diagram)\/([a-z0-9][a-z0-9-]*)|@([a-z0-9][a-z0-9-]*)/gi;
  for (const match of input.userPrompt.matchAll(mentionPattern)) {
    const token = match[0];
    const typed = match[1] && match[2]
      ? optionsByTypedToken.get(`@${match[1].toLowerCase()}/${match[2].toLowerCase()}`)
      : undefined;
    const bare = match[3] ? optionsByHandle.get(match[3].toLowerCase()) ?? [] : [];
    if (!typed && bare.length > 1) {
      throw new Error(`ambiguous reference ${token}; use @entity/ or @diagram/`);
    }
    const option = typed ?? bare[0];
    if (!option) throw new Error(`unknown prompt reference: ${token}`);
    const key = `${option.kind}:${option.id}`;
    if (seenReferences.has(key)) continue;
    seenReferences.add(key);
    references.push({
      kind: option.kind,
      targetId: option.id,
      token,
      handle: option.handle
    });
  }

  const selectedFromReferences = references
    .filter((reference) => reference.kind === "code-entity")
    .map((reference) => reference.targetId);
  const referencedDiagrams = references
    .filter((reference) => reference.kind === "diagram")
    .map((reference) => diagramsById.get(reference.targetId))
    .filter((diagram): diagram is DiagramRecord => Boolean(diagram));
  const allowedCodeEntityIds = [...new Set([
    ...selected,
    ...selectedFromReferences,
    ...referencedDiagrams.flatMap((diagram) => diagram.codeEntityIds)
  ])];

  const selectedBlocks = [...new Set([...selected, ...selectedFromReferences])]
    .map((id) => new CodeEntity(entitiesById.get(id)!).prompt_str());
  const diagramBlocks = referencedDiagrams.map((diagram) => new Diagram(diagram).prompt_str());
  const resolvedPrompt = [
    `DiagramSet: ${input.diagramSet.name}`,
    `Original request: ${input.diagramSet.initialPrompt || "none"}`,
    `User instruction:\n${input.userPrompt.trim() || "Create a clear diagram from the selected code entities."}`,
    `Selected CodeEntities:\n${selectedBlocks.join("\n\n") || "none"}`,
    `Referenced Diagrams:\n${diagramBlocks.join("\n\n") || "none"}`,
    "Generate one architecture diagram. Use only 7-bit ASCII. Every code label must map to one of the supplied CodeEntity ids."
  ].join("\n\n");

  return { references, selectedCodeEntityIds: selected, allowedCodeEntityIds, resolvedPrompt };
}
