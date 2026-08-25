import type { CodeEntityRecord, DiagramElementMapping, ReferenceIdentity } from "./domain";

export interface RefBufferState {
  scopeKey: string | null;
  entries: ReferenceIdentity[];
}

export type RefBufferAction =
  | { type: "scope"; scopeKey: string | null }
  | { type: "add"; refs: ReferenceIdentity[] }
  | { type: "remove"; ref: ReferenceIdentity }
  | { type: "clear" }
  | { type: "replace"; refs: ReferenceIdentity[] };

export const EMPTY_REF_BUFFER: RefBufferState = { scopeKey: null, entries: [] };

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

export function reduceRefBuffer(state: RefBufferState, action: RefBufferAction): RefBufferState {
  if (action.type === "scope") {
    return action.scopeKey === state.scopeKey
      ? state
      : { scopeKey: action.scopeKey, entries: [] };
  }
  if (action.type === "clear") {
    return state.entries.length === 0 ? state : { ...state, entries: [] };
  }
  if (action.type === "replace") {
    return { ...state, entries: uniqueReferences(action.refs) };
  }
  if (action.type === "remove") {
    const key = referenceIdentityKey(action.ref);
    const entries = state.entries.filter((ref) => referenceIdentityKey(ref) !== key);
    return entries.length === state.entries.length ? state : { ...state, entries };
  }
  const existing = new Set(state.entries.map(referenceIdentityKey));
  const additions = uniqueReferences(action.refs).filter((ref) => !existing.has(referenceIdentityKey(ref)));
  return additions.length === 0 ? state : { ...state, entries: [...state.entries, ...additions] };
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
