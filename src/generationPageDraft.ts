import {
  isDiagramModelId,
  isGenerationTargetKind,
  isGenerationPromptProfileId,
  type DiagramModelId,
  type GenerationOutputKind,
  type GenerationTargetKind,
  type GenerationPromptProfileId
} from "./domain";

const GENERATION_PAGE_DRAFT_PREFIX = "new-diagram:generation-draft";
const LEGACY_GENERATION_PROMPT_DRAFT_PREFIX = "new-diagram:generation-prompt";

export interface GenerationDraftSource {
  sourceArtifactKind: GenerationOutputKind;
  sourceArtifactId: string;
}

export interface GenerationPageDraft {
  version: 3;
  prompt: string;
  selectedCodeEntityIds: string[];
  excludedReferenceKeys: string[];
  count: number;
  targetKind: GenerationTargetKind;
  modelId: DiagramModelId;
  promptProfileId: GenerationPromptProfileId;
}

function scope(source?: GenerationDraftSource | null): string {
  return source ? `${source.sourceArtifactKind}:${source.sourceArtifactId}` : "new";
}

export function generationPageDraftKey(
  projectId: string,
  diagramSetId: string,
  source?: GenerationDraftSource | null
): string {
  return `${GENERATION_PAGE_DRAFT_PREFIX}:${projectId}:${diagramSetId}:${scope(source)}`;
}

export function legacyGenerationPromptDraftKey(
  projectId: string,
  diagramSetId: string,
  source?: GenerationDraftSource | null
): string {
  return `${LEGACY_GENERATION_PROMPT_DRAFT_PREFIX}:${projectId}:${diagramSetId}:${scope(source)}`;
}

export function readGenerationPageDraft(storage: Storage, key: string): GenerationPageDraft | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.version !== 3
      || typeof value.prompt !== "string"
      || !Array.isArray(value.selectedCodeEntityIds)
      || !value.selectedCodeEntityIds.every((id) => typeof id === "string")
      || !Array.isArray(value.excludedReferenceKeys)
      || !value.excludedReferenceKeys.every((referenceKey) => typeof referenceKey === "string")
      || !Number.isInteger(value.count)
      || (value.count as number) < 1
      || (value.count as number) > 12
      || !isGenerationTargetKind(value.targetKind)
      || !isDiagramModelId(value.modelId)
      || !isGenerationPromptProfileId(value.promptProfileId)) return null;
    return value as unknown as GenerationPageDraft;
  } catch {
    return null;
  }
}

export function readLegacyGenerationPromptDraft(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

export function saveGenerationPageDraft(
  storage: Storage,
  key: string,
  draft: GenerationPageDraft
): void {
  try {
    storage.setItem(key, JSON.stringify(draft));
  } catch {
    // Keep generation controls usable when browser storage is unavailable.
  }
}
