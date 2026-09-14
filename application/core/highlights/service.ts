import { createHash } from "node:crypto";
import type { HighlightRecordV2 } from "../../../domain/core/highlights/highlights";
import { representationKindForArtifact } from "../../../domain/core/profiles/domainProfiles";
import {
  type WorkspaceSnapshot
} from "../../../domain/core/records/domain";
import { buildRepresentationIndex, representationElementIdForMapping, treeRepresentationLineage } from "../../../domain/core/representations/representationIndex";
import type { CoreContext } from '../context';
import { mappedArtifactBundle } from '../imports/service';
import { timestamp } from '../shared';
import { workspace } from '../workspace/service';

export async function addHighlight(context: CoreContext, input: {
  diagramSetId: unknown;
  artifactKind: unknown;
  artifactId: unknown;
  mappingId: unknown;
}): Promise<WorkspaceSnapshot> {
  const diagramSetId = typeof input.diagramSetId === "string" ? input.diagramSetId : "";
  const artifactId = typeof input.artifactId === "string" ? input.artifactId : "";
  const mappingId = typeof input.mappingId === "string" ? input.mappingId : "";
  const artifactKind = input.artifactKind;
  if (!diagramSetId || !artifactId || !mappingId) throw new Error("highlight target is incomplete");
  if (artifactKind !== "diagram" && artifactKind !== "diagram-component") {
    throw new Error("highlight artifact kind must be diagram or diagram-component");
  }
  const set = await context.store.loadDiagramSet(diagramSetId);
  const bundle = await mappedArtifactBundle(context, diagramSetId, artifactKind, artifactId);
  const mapping = bundle.codeEntityMap?.mappings.find((candidate) => candidate.id === mappingId);
  if (!mapping) throw new Error(`unknown mapped tree node: ${mappingId}`);
  const entity = bundle.codeEntities.find((candidate) => candidate.id === mapping.entityId);
  if (!entity) throw new Error(`unknown mapped CodeEntity: ${mapping.entityId}`);
  const range = mapping.sourceRangeId
    ? entity.sourceRanges.find((candidate) => candidate.id === mapping.sourceRangeId)
    : entity.sourceRanges[mapping.sourceRangeIndex];
  if (!range) throw new Error("mapped source range was not found");
  const revision = {
    artifactId: bundle.artifact.id,
    asciiSha256: createHash("sha256").update(bundle.artifact.ascii).digest("hex")
  };
  const representationKind = representationKindForArtifact(bundle.artifact);
  const representationIndex = buildRepresentationIndex({
    kind: representationKind,
    revision,
    ascii: bundle.artifact.ascii,
    codeEntityMap: bundle.codeEntityMap
  });
  const representationElementId = representationElementIdForMapping(representationIndex, mappingId);
  if (!representationElementId) throw new Error(`mapped representation element was not found: ${mappingId}`);
  const rawLine = bundle.artifact.ascii.replace(/\r\n?/g, "\n").split("\n")[mapping.line - 1] ?? "";
  const elementText = representationIndex.kind === "tree"
    ? representationIndex.nodes[representationElementId]?.text ?? rawLine.trim()
    : rawLine.slice(mapping.startColumn - 1, mapping.endColumn).trim();
  if (!elementText) throw new Error("mapped representation element has no display text");
  const highlightBase = {
    schemaVersion: 2 as const,
    id: context.store.ids.highlight(),
    projectId: set.projectId,
    diagramSetId,
    artifactKind,
    artifactId,
    artifactName: bundle.artifact.name,
    artifactRevision: revision,
    representationElementId,
    mappingId,
    elementText,
    evidence: {
      evidenceId: entity.id,
      ...(range.id ? { sourceRangeId: range.id } : {}),
      sourceRangeIndex: mapping.sourceRangeIndex
    },
    ...(range.originalLines ? {
      documentExcerpt: {
        path: range.path,
        startLine: range.startLine,
        endLine: range.endLine,
        lines: [...range.originalLines]
      }
    } : {}),
    createdAt: timestamp()
  };
  const highlight: HighlightRecordV2 = representationIndex.kind === "tree"
    ? {
      ...highlightBase,
      representationKind: "tree",
      treeLineage: treeRepresentationLineage(representationIndex, representationElementId)
        .map((node) => ({
          representationElementId: node.id,
          line: node.line,
          text: node.text
        }))
    }
    : { ...highlightBase, representationKind: "diagram" };
  await context.store.saveHighlight(highlight);
  return workspace(context);
}

export async function deleteHighlight(context: CoreContext, highlightId: string): Promise<WorkspaceSnapshot> {
  await context.store.deleteHighlight(highlightId);
  return workspace(context);
}
