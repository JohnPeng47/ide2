import type { CompactionProjectionInput } from "./compactionProjection";

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
