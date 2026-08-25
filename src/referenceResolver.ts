import {
  CodeEntity,
  type CodeEntityRecord,
  type DiagramComponentRecord,
  type DiagramRecord,
  type ReferenceIdentity,
  type SelectableText,
  type SourceRange
} from "./domain";

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

export function resolveReference(
  identity: ReferenceIdentity,
  context: ReferenceResolutionContext
): ResolvedReference | null {
  if (identity.kind === "code-entity") {
    const record = context.codeEntities.find((entity) => entity.id === identity.targetId);
    if (!record) return null;
    const sourceRange = identity.sourceRangeIndex === undefined
      ? undefined
      : record.sourceRanges[identity.sourceRangeIndex];
    if (identity.sourceRangeIndex !== undefined && !sourceRange) return null;
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
    return record ? { identity, kind: "diagram", record } : null;
  }
  const record = context.components[identity.targetId];
  return record ? { identity, kind: "diagram-component", record } : null;
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
