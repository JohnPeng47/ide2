import {
  CodeEntity,
  type CodeEntityRecord,
  type DiagramComponentRecord,
  type DiagramRecord,
  type ReferenceIdentity,
  type SelectableText,
  type SourceRange
} from "../records/domain";

interface ResolvedReferenceBase {
  identity: ReferenceIdentity;
  selectableText?: SelectableText;
}

export type ResolvedReference = ResolvedReferenceBase & (
  | {
      kind: "code-entity";
      record: CodeEntityRecord;
      sourceRange?: SourceRange;
    }
  | {
      kind: "diagram";
      record: DiagramRecord;
    }
  | {
      kind: "diagram-component";
      record: DiagramComponentRecord;
    }
);

export interface ReferenceResolutionContext {
  codeEntities: readonly CodeEntityRecord[];
  diagrams: Readonly<Record<string, DiagramRecord>>;
  components: Readonly<Record<string, DiagramComponentRecord>>;
}

export interface ReferenceResolutionResult {
  resolved: ResolvedReference[];
  unresolved: ReferenceIdentity[];
}

function sameOrigin(
  expected: ReferenceIdentity["origin"],
  actual: ReferenceIdentity["origin"]
): boolean {
  if (!expected || !actual) return true;
  return expected.projectId === actual.projectId
    && expected.diagramSetId === actual.diagramSetId
    && (!("codeEntitiesSetId" in expected) || (
      "codeEntitiesSetId" in actual
      && expected.codeEntitiesSetId === actual.codeEntitiesSetId
    ));
}

export function resolveReference(
  identity: ReferenceIdentity,
  context: ReferenceResolutionContext
): ResolvedReference | null {
  if (identity.kind === "code-entity") {
    const record = context.codeEntities.find((entity) => (
      entity.id === identity.targetId && sameOrigin(identity.origin, entity.origin)
    ));
    if (!record) return null;
    const sourceRange = identity.sourceRangeId
      ? record.sourceRanges.find((range) => range.id === identity.sourceRangeId)
      : identity.sourceRangeIndex === undefined
        ? undefined
        : record.sourceRanges[identity.sourceRangeIndex];
    if ((identity.sourceRangeId !== undefined || identity.sourceRangeIndex !== undefined)
      && !sourceRange) return null;
    return {
      identity,
      kind: "code-entity",
      record,
      ...(sourceRange ? { sourceRange } : {}),
      selectableText: new CodeEntity(record)
    };
  }
  if (identity.kind === "diagram") {
    const record = context.diagrams[identity.targetId];
    return record && sameOrigin(identity.origin, record.recordOrigin)
      ? { identity, kind: "diagram", record }
      : null;
  }
  const record = context.components[identity.targetId];
  return record && sameOrigin(identity.origin, record.recordOrigin)
    ? { identity, kind: "diagram-component", record }
    : null;
}

export function resolveReferences(
  identities: ReferenceIdentity[],
  context: ReferenceResolutionContext
): ReferenceResolutionResult {
  const resolved: ResolvedReference[] = [];
  const unresolved: ReferenceIdentity[] = [];
  for (const identity of identities) {
    const reference = resolveReference(identity, context);
    if (reference) resolved.push(reference);
    else unresolved.push(identity);
  }
  return { resolved, unresolved };
}
