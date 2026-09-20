import {
  type DiagramViewKind
} from "../records/domain";
import type { CompactionProjectionInput } from "./compactionProjection";
import type {
  ProjectRepresentationEvidenceRecord,
  ProjectRepresentationMappingRecord
} from "./projectCatalog";

export interface ProjectRepresentationPromotionDraft {
  source?: import("../diagrams/diagram").DiagramSourceBinding;
  projectId: string;
  representationId?: string;
  expectedRevisionId?: string;
  handle: string;
  name: string;
  viewKind: DiagramViewKind;
  representationKind: "tree" | "diagram";
  ascii: string;
  asciiSha256: string;
  evidence: Record<string, ProjectRepresentationEvidenceRecord>;
  mappings: ProjectRepresentationMappingRecord[];
  provenance: {
    diagramSetId: string;
    artifactId: string;
  };
  makeActive: boolean;
}

export interface SaveProjectedTreeInput {
  sourceRepresentationId: string;
  sourceRevisionId: string;
  name: string;
  ascii: string;
  links: { sourceEvidenceIds: string[]; targetLines: number[] }[];
  compactionProjection?: CompactionProjectionInput;
  /** Explicit regeneration appends a revision to an existing projected tree. */
  targetRepresentationId?: string;
  expectedTargetRevisionId?: string;
}
