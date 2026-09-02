import type { CodeEntityRecord, DiagramElementMapping, ReferenceIdentity } from "./domain";

export interface RefBufferState {
  scopeKey: string | null;
  entries: ReferenceIdentity[];
  diagramSelections: BufferedDiagramSelection[];
}

export interface BufferedDiagramSelection {
  sourceArtifactId: string;
  ascii: string;
  referenceKeys: string[];
}

export interface BufferedDiagramSelectionInput {
  sourceArtifactId: string;
  ascii: string;
}

export type RefBufferAction =
  | { type: "scope"; scopeKey: string | null }
  | { type: "add"; refs: ReferenceIdentity[]; diagramSelection?: BufferedDiagramSelectionInput }
  | { type: "remove"; ref: ReferenceIdentity }
  | { type: "clear" }
  | { type: "replace"; refs: ReferenceIdentity[] };

export const EMPTY_REF_BUFFER: RefBufferState = { scopeKey: null, entries: [], diagramSelections: [] };

export function referenceIdentityKey(ref: ReferenceIdentity): string {
  const origin = ref.origin
    ? "codeEntitiesSetId" in ref.origin
      ? `${ref.origin.projectId}:${ref.origin.diagramSetId}:${ref.origin.codeEntitiesSetId}`
      : `${ref.origin.projectId}:${ref.origin.diagramSetId}`
    : "legacy";
  return `${ref.kind}:${origin}:${ref.targetId}:${ref.sourceRangeId ?? ref.sourceRangeIndex ?? "*"}`;
}

function uniqueReferences(refs: ReferenceIdentity[]): ReferenceIdentity[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = referenceIdentityKey(ref);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function diagramSelectionKey(selection: BufferedDiagramSelection): string {
  return `${selection.sourceArtifactId}\n${selection.ascii}\n${selection.referenceKeys.join("\n")}`;
}

export function reduceRefBuffer(state: RefBufferState, action: RefBufferAction): RefBufferState {
  if (action.type === "scope") {
    return action.scopeKey === state.scopeKey
      ? state
      : { scopeKey: action.scopeKey, entries: [], diagramSelections: [] };
  }
  if (action.type === "clear") {
    return state.entries.length === 0 && state.diagramSelections.length === 0
      ? state
      : { ...state, entries: [], diagramSelections: [] };
  }
  if (action.type === "replace") {
    return { ...state, entries: uniqueReferences(action.refs), diagramSelections: [] };
  }
  if (action.type === "remove") {
    const key = referenceIdentityKey(action.ref);
    const entries = state.entries.filter((ref) => referenceIdentityKey(ref) !== key);
    if (entries.length === state.entries.length) return state;
    const diagramSelections = state.diagramSelections.flatMap((selection) => {
      const referenceKeys = selection.referenceKeys.filter((candidate) => candidate !== key);
      return referenceKeys.length > 0 ? [{ ...selection, referenceKeys }] : [];
    });
    return { ...state, entries, diagramSelections };
  }
  const existing = new Set(state.entries.map(referenceIdentityKey));
  const uniqueRefs = uniqueReferences(action.refs);
  const additions = uniqueRefs.filter((ref) => !existing.has(referenceIdentityKey(ref)));
  const referenceKeys = uniqueRefs.map(referenceIdentityKey);
  const diagramSelection = action.diagramSelection && referenceKeys.length > 0
    ? { ...action.diagramSelection, referenceKeys }
    : undefined;
  const selectionExists = diagramSelection
    ? new Set(state.diagramSelections.map(diagramSelectionKey)).has(diagramSelectionKey(diagramSelection))
    : true;
  if (additions.length === 0 && selectionExists) return state;
  return {
    ...state,
    entries: [...state.entries, ...additions],
    diagramSelections: diagramSelection && !selectionExists
      ? [...state.diagramSelections, diagramSelection]
      : state.diagramSelections
  };
}

export function referenceFromMapping(
  mapping: DiagramElementMapping,
  entities: readonly CodeEntityRecord[]
): ReferenceIdentity {
  const entity = entities.find((candidate) => candidate.id === mapping.entityId);
  const range = mapping.sourceRangeId
    ? entity?.sourceRanges.find((candidate) => candidate.id === mapping.sourceRangeId)
    : entity?.sourceRanges[mapping.sourceRangeIndex];
  return {
    kind: "code-entity",
    targetId: mapping.entityId,
    ...(entity?.origin ? { origin: entity.origin } : {}),
    ...(range?.id
      ? { sourceRangeId: range.id }
      : mapping.sourceRangeId
        ? { sourceRangeId: mapping.sourceRangeId }
        : { sourceRangeIndex: mapping.sourceRangeIndex })
  };
}

export function referencesFromMappings(
  mappings: DiagramElementMapping[],
  entities: readonly CodeEntityRecord[] = []
): ReferenceIdentity[] {
  return mappings.map((mapping) => referenceFromMapping(mapping, entities));
}
