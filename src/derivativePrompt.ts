import {
  isDiagramArchived,
  type DiagramComponentRecord,
  type DiagramRecord,
  type GenerationDerivationRecord,
  type GenerationOutputKind,
  type GenerationPromptConfigRecord,
  type PromptReference
} from "./domain";

export const PREVIOUS_PROMPT_HEADER = "---- PREVIOUS PROMPT ----";
export const PREVIOUS_PROMPT_FOOTER = "-------------------------";

type Artifact = DiagramRecord | DiagramComponentRecord;

export interface DerivativePromptDraft {
  prompt: string;
  prefix: string;
  historicalReferences: PromptReference[];
  derivation: Omit<GenerationDerivationRecord, "promptCorrection">;
}

export interface DiagramReferenceMention extends PromptReference {
  kind: "diagram";
  key: string;
  label: string;
  available: boolean;
  tokens: string[];
}

function artifactForReference(
  reference: Pick<PromptReference, "kind" | "targetId">,
  diagrams: Record<string, DiagramRecord>,
  components: Record<string, DiagramComponentRecord>
): Artifact | undefined {
  return reference.kind === "diagram"
    ? diagrams[reference.targetId]
    : reference.kind === "diagram-component"
      ? components[reference.targetId]
      : undefined;
}

function parentReference(config: GenerationPromptConfigRecord): PromptReference | undefined {
  if (config.derivation) {
    return {
      kind: config.derivation.sourceArtifactKind,
      targetId: config.derivation.sourceArtifactId,
      token: "",
      handle: ""
    };
  }
  return config.references.find((reference) => reference.kind === "diagram")
    ?? config.references.find((reference) => reference.kind === "diagram-component");
}

function previousPromptBlock(instruction: string): string {
  return `${PREVIOUS_PROMPT_HEADER}\n${instruction.trim()}\n${PREVIOUS_PROMPT_FOOTER}`;
}

export function buildDerivativePrompt(input: {
  sourceArtifactKind: GenerationOutputKind;
  sourceArtifact: Artifact;
  diagrams: Record<string, DiagramRecord>;
  components: Record<string, DiagramComponentRecord>;
  promptConfigs: Record<string, GenerationPromptConfigRecord>;
}): DerivativePromptDraft {
  const corrections: string[] = [];
  const historicalReferences: PromptReference[] = [];
  const seenArtifacts = new Set<string>();
  const seenPromptConfigs = new Set<string>();
  const seenReferences = new Set<string>();
  let artifact: Artifact | undefined = input.sourceArtifact;

  while (artifact && !seenArtifacts.has(artifact.id)) {
    seenArtifacts.add(artifact.id);
    const config = artifact.generationPromptConfigId
      ? input.promptConfigs[artifact.generationPromptConfigId]
      : undefined;
    if (!config || seenPromptConfigs.has(config.id)) break;
    seenPromptConfigs.add(config.id);
    const correction = config.derivation?.promptCorrection ?? config.instruction;
    if (correction.trim()) corrections.push(correction.trim());
    for (const reference of [...config.references, ...(config.omittedReferences ?? [])]) {
      const key = `${reference.kind}:${reference.targetId}:${reference.token.toLowerCase()}`;
      if (seenReferences.has(key)) continue;
      seenReferences.add(key);
      historicalReferences.push(reference);
    }
    const parent = parentReference(config);
    artifact = parent
      ? artifactForReference(parent, input.diagrams, input.components)
      : undefined;
  }

  corrections.reverse();
  const sourceToken = input.sourceArtifactKind === "diagram"
    ? `@diagram/${input.sourceArtifact.handle}`
    : `@component/${input.sourceArtifact.handle}`;
  const history = corrections.map(previousPromptBlock).join("\n\n");
  const prefix = history ? `${history}\n\n${sourceToken}\n\n` : `${sourceToken} `;
  return {
    prompt: prefix,
    prefix,
    historicalReferences,
    derivation: {
      sourceArtifactKind: input.sourceArtifactKind,
      sourceArtifactId: input.sourceArtifact.id
    }
  };
}

export function promptCorrection(prompt: string, draft: DerivativePromptDraft): string {
  return prompt.startsWith(draft.prefix)
    ? prompt.slice(draft.prefix.length).trim()
    : prompt.trim();
}

export function diagramReferencesInPrompt(input: {
  prompt: string;
  diagrams: Record<string, DiagramRecord>;
  historicalReferences: PromptReference[];
}): DiagramReferenceMention[] {
  const currentByToken = new Map(Object.values(input.diagrams).flatMap((diagram) => ([
    [`@diagram/${diagram.handle}`.toLowerCase(), diagram] as const,
    [`@${diagram.handle}`.toLowerCase(), diagram] as const
  ])));
  const historicalByToken = new Map(input.historicalReferences
    .filter((reference) => reference.kind === "diagram")
    .map((reference) => [reference.token.toLowerCase(), reference]));
  const byKey = new Map<string, DiagramReferenceMention>();
  for (const match of input.prompt.matchAll(
    /@diagram\/[a-z0-9][a-z0-9-]*|@[a-z0-9][a-z0-9-]*(?![a-z0-9-]|\/)/gi
  )) {
    const token = match[0];
    const current = currentByToken.get(token.toLowerCase());
    const historical = historicalByToken.get(token.toLowerCase());
    const targetId = current?.id ?? historical?.targetId;
    if (!targetId) continue;
    const diagram = input.diagrams[targetId];
    const handle = diagram?.handle ?? historical?.handle ?? token.slice("@diagram/".length);
    const key = `diagram:${targetId}`;
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.tokens.some((candidate) => candidate.toLowerCase() === token.toLowerCase())) {
        existing.tokens.push(token);
      }
      continue;
    }
    byKey.set(key, {
      kind: "diagram",
      targetId,
      token,
      handle,
      key,
      label: diagram?.name ?? historical?.handle ?? handle,
      available: Boolean(diagram && !isDiagramArchived(diagram)),
      tokens: [token]
    });
  }
  return [...byKey.values()];
}
