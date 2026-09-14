import {
  isDiagramArchived,
  type DiagramComponentRecord,
  type DiagramRecord,
  type GenerationDerivationRecord,
  type GenerationOutputKind,
  type GenerationPromptConfigRecord,
  type PromptReference
} from "../../../../domain/core/records/domain";

export const PREVIOUS_PROMPT_HEADER = "---- PREVIOUS PROMPT ----";
export const PREVIOUS_PROMPT_FOOTER = "-------------------------";

type Artifact = DiagramRecord | DiagramComponentRecord;

export interface DerivativePromptDraft {
  prompt: string;
  prefix: string;
  sourceToken: string;
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
      ...(config.derivation.sourceArtifactOrigin
        ? { origin: config.derivation.sourceArtifactOrigin }
        : {}),
      token: "",
      handle: ""
    };
  }
  return config.references.find((reference) => reference.kind === "diagram")
    ?? config.references.find((reference) => reference.kind === "diagram-component");
}

function sourceTokenForArtifact(kind: GenerationOutputKind, artifact: Artifact): string {
  return kind === "diagram"
    ? `@diagram/${artifact.handle}`
    : `@component/${artifact.handle}`;
}

function correctionAfterSourceToken(instruction: string, sourceToken: string): string {
  const escapedToken = sourceToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const markers = [...instruction.matchAll(new RegExp(`(?:^|\\n)${escapedToken}(?=\\s|$)`, "g"))];
  const marker = markers.at(-1);
  if (!marker || marker.index === undefined) return instruction.trim();
  const tokenStart = marker.index + (marker[0].startsWith("\n") ? 1 : 0);
  return instruction.slice(tokenStart + sourceToken.length).trim();
}

function previousPromptBlock(instruction: string, index: number): string {
  return `---- PREVIOUS PROMPT ${index} ----\n${instruction.trim()}\n${PREVIOUS_PROMPT_FOOTER}`;
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
    const parent = parentReference(config);
    const parentArtifact = parent
      ? artifactForReference(parent, input.diagrams, input.components)
      : undefined;
    const storedCorrection = config.derivation?.promptCorrection ?? config.instruction;
    const storedSourceToken = config.derivation
      ? [...config.references, ...(config.omittedReferences ?? [])].find((reference) => (
        reference.kind === config.derivation!.sourceArtifactKind
        && reference.targetId === config.derivation!.sourceArtifactId
      ))?.token
      : undefined;
    const correction = config.derivation && parentArtifact
      ? correctionAfterSourceToken(
        storedCorrection,
        storedSourceToken
          || sourceTokenForArtifact(config.derivation.sourceArtifactKind, parentArtifact)
      )
      : storedCorrection.trim();
    if (correction.trim()) corrections.push(correction.trim());
    for (const reference of [...config.references, ...(config.omittedReferences ?? [])]) {
      const key = `${reference.kind}:${reference.targetId}:${reference.token.toLowerCase()}`;
      if (seenReferences.has(key)) continue;
      seenReferences.add(key);
      historicalReferences.push(reference);
    }
    artifact = parentArtifact;
  }

  corrections.reverse();
  const sourceToken = sourceTokenForArtifact(input.sourceArtifactKind, input.sourceArtifact);
  const history = corrections
    .map((correction, index) => previousPromptBlock(correction, index + 1))
    .join("\n\n");
  const prefix = history ? `${history}\n\n${sourceToken}\n\n` : `${sourceToken} `;
  return {
    prompt: prefix,
    prefix,
    sourceToken,
    historicalReferences,
    derivation: {
      sourceArtifactKind: input.sourceArtifactKind,
      sourceArtifactId: input.sourceArtifact.id,
      ...(input.sourceArtifact.recordOrigin
        ? { sourceArtifactOrigin: input.sourceArtifact.recordOrigin }
        : {})
    }
  };
}

export function promptCorrection(prompt: string, draft: DerivativePromptDraft): string {
  return prompt.startsWith(draft.prefix)
    ? prompt.slice(draft.prefix.length).trim()
    : correctionAfterSourceToken(prompt, draft.sourceToken);
}

export function rebaseDerivativePrompt(prompt: string, draft: DerivativePromptDraft): string {
  const correction = promptCorrection(prompt, draft);
  return correction ? `${draft.prefix}${correction}` : draft.prompt;
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
      ...(diagram?.recordOrigin
        ? { origin: diagram.recordOrigin }
        : historical?.origin ? { origin: historical.origin } : {}),
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
