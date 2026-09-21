import type { DiagramViewKind } from "../records/domain";
import type {
  BuiltInDomainProfileId
} from "./domainProfile";

/** Resolve legacy artifacts from declared metadata, never from ASCII or file content. */
export function representationKindForArtifact(artifact: {
  representationKind?: "tree" | "diagram";
  viewKind?: DiagramViewKind;
}): "tree" | "diagram" {
  if (artifact.representationKind) return artifact.representationKind;
  return artifact.viewKind === "call-graph" || artifact.viewKind === "dir-view"
    ? "tree"
    : "diagram";
}

export function isBuiltInDomainProfileId(value: unknown): value is BuiltInDomainProfileId {
  return value === "source-code" || value === "document";
}
