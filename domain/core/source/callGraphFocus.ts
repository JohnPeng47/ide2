import type {
  ArtifactOrigin,
  CodeEntityOrigin,
  DiagramRecord,
  ReferenceIdentity
} from "../records/domain";

export const CALL_GRAPH_FOCUS_VERSION = 1 as const;

export interface CodeEntityFocusIdentity {
  kind: "code-entity";
  targetId: string;
  origin: CodeEntityOrigin;
}

export interface DiagramFocusIdentity {
  kind: "diagram";
  targetId: string;
  origin: ArtifactOrigin;
}

export interface CallGraphFocusRequest {
  version: typeof CALL_GRAPH_FOCUS_VERSION;
  /** DiagramSet whose featured call graph should be collapsed. */
  diagramSetId: string;
  sourceDiagram: DiagramFocusIdentity;
  selectedCodeEntities: readonly CodeEntityFocusIdentity[];
}

export interface CallGraphFocusNode {
  id: string;
  label: string;
  codeEntity?: CodeEntityFocusIdentity;
  children: CallGraphFocusNode[];
}

export interface CallGraphFocusResult {
  version: typeof CALL_GRAPH_FOCUS_VERSION;
  diagramSetId: string;
  sourceDiagram: DiagramFocusIdentity;
  callGraph: DiagramFocusIdentity;
  callGraphName: string;
  roots: CallGraphFocusNode[];
}

export type OpenCallGraphFocus = (
  request: CallGraphFocusRequest
) => Promise<void>;

function isCodeEntityOrigin(origin: ReferenceIdentity["origin"]): origin is CodeEntityOrigin {
  return Boolean(origin && "codeEntitiesSetId" in origin);
}

function codeEntityIdentityKey(identity: CodeEntityFocusIdentity): string {
  return [
    identity.origin.projectId,
    identity.origin.diagramSetId,
    identity.origin.codeEntitiesSetId,
    identity.targetId
  ].join(":");
}

export function createCallGraphFocusRequest(input: {
  diagramSetId: string;
  sourceDiagram: DiagramRecord;
  references: Iterable<ReferenceIdentity>;
}): CallGraphFocusRequest {
  if (!input.diagramSetId) throw new Error("a call-graph focus request requires a DiagramSet");
  if (!input.sourceDiagram.recordOrigin) {
    throw new Error("the source Diagram is missing provenance");
  }
  const selected = new Map<string, CodeEntityFocusIdentity>();
  for (const reference of input.references) {
    if (reference.kind !== "code-entity") continue;
    if (!isCodeEntityOrigin(reference.origin)) {
      throw new Error(`CodeEntity ${reference.targetId} is missing provenance`);
    }
    const identity: CodeEntityFocusIdentity = {
      kind: "code-entity",
      targetId: reference.targetId,
      origin: reference.origin
    };
    selected.set(codeEntityIdentityKey(identity), identity);
  }
  const selectedCodeEntities = [...selected.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, identity]) => identity);
  if (selectedCodeEntities.length === 0) {
    throw new Error("a call-graph focus request requires at least one mapped CodeEntity");
  }
  return {
    version: CALL_GRAPH_FOCUS_VERSION,
    diagramSetId: input.diagramSetId,
    sourceDiagram: {
      kind: "diagram",
      targetId: input.sourceDiagram.id,
      origin: input.sourceDiagram.recordOrigin
    },
    selectedCodeEntities
  };
}

export function focusIdentityKey(identity: CodeEntityFocusIdentity): string {
  return codeEntityIdentityKey(identity);
}
