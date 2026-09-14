import {
  type CodeEntityRecord
} from "../../domain/core/records/domain";
import {
  CALL_GRAPH_FOCUS_VERSION,
  type CallGraphFocusRequest,
  type CodeEntityFocusIdentity
} from "../../domain/core/source/callGraphFocus";

export function timestamp(): string {
  return new Date().toISOString();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} must be a non-empty string`);
  return value;
}

export function parseArtifactOrigin(value: unknown, label: string): { projectId: string; diagramSetId: string } {
  if (!isRecord(value)) throw new Error(`${label} is missing provenance`);
  return {
    projectId: requiredString(value.projectId, `${label} projectId`),
    diagramSetId: requiredString(value.diagramSetId, `${label} diagramSetId`)
  };
}

export function parseCallGraphFocusRequest(value: unknown): CallGraphFocusRequest {
  if (!isRecord(value)) throw new Error("call-graph focus request must be an object");
  if (value.version !== CALL_GRAPH_FOCUS_VERSION) {
    throw new Error(`unsupported call-graph focus request version: ${String(value.version)}`);
  }
  if (!isRecord(value.sourceDiagram) || value.sourceDiagram.kind !== "diagram") {
    throw new Error("call-graph focus request requires a qualified source Diagram");
  }
  if (!Array.isArray(value.selectedCodeEntities) || value.selectedCodeEntities.length === 0) {
    throw new Error("call-graph focus request requires at least one selected CodeEntity");
  }
  const sourceOrigin = parseArtifactOrigin(value.sourceDiagram.origin, "source Diagram");
  const selectedCodeEntities: CodeEntityFocusIdentity[] = value.selectedCodeEntities.map(
    (candidate, index) => {
      if (!isRecord(candidate) || candidate.kind !== "code-entity") {
        throw new Error(`selected CodeEntity ${index + 1} is invalid`);
      }
      const origin = parseArtifactOrigin(candidate.origin, `selected CodeEntity ${index + 1}`);
      if (!isRecord(candidate.origin)) throw new Error(`selected CodeEntity ${index + 1} is missing provenance`);
      return {
        kind: "code-entity",
        targetId: requiredString(candidate.targetId, `selected CodeEntity ${index + 1} targetId`),
        origin: {
          ...origin,
          codeEntitiesSetId: requiredString(
            candidate.origin.codeEntitiesSetId,
            `selected CodeEntity ${index + 1} codeEntitiesSetId`
          )
        }
      };
    }
  );
  return {
    version: CALL_GRAPH_FOCUS_VERSION,
    diagramSetId: requiredString(value.diagramSetId, "diagramSetId"),
    sourceDiagram: {
      kind: "diagram",
      targetId: requiredString(value.sourceDiagram.targetId, "source Diagram targetId"),
      origin: sourceOrigin
    },
    selectedCodeEntities
  };
}

export function sameArtifactOrigin(
  left: { projectId: string; diagramSetId: string },
  right: { projectId: string; diagramSetId: string }
): boolean {
  return left.projectId === right.projectId && left.diagramSetId === right.diagramSetId;
}

export function identityForRecord(entity: CodeEntityRecord): CodeEntityFocusIdentity {
  if (!entity.origin) throw new Error(`CodeEntity ${entity.id} is missing provenance`);
  return { kind: "code-entity", targetId: entity.id, origin: entity.origin };
}
