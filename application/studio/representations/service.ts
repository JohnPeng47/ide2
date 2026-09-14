import { createHash } from "node:crypto";
import {
  assertSpatialProgressState,
  type SpatialProgressState
} from "../../../domain/core/agent-work/agentWork";
import { representationKindForArtifact } from "../../../domain/core/profiles/domainProfiles";
import {
  type WorkspaceSnapshot
} from "../../../domain/core/records/domain";
import {
  appendRepresentationFeedback,
  assertRepresentationGraph,
  type RepresentationFeedbackTarget,
  type RepresentationGraphRecord
} from "../../../domain/core/representations/representationGraph";
import { buildRepresentationIndex } from "../../../domain/core/representations/representationIndex";
import type { StudioContext } from '../context';
import { timestamp } from '../shared';

export async function saveRepresentationGraph(context: StudioContext, setId: string, input: RepresentationGraphRecord): Promise<WorkspaceSnapshot> {
  const set = await context.store.loadDiagramSet(setId);
  if (input.diagramSetId && input.diagramSetId !== setId) {
    throw new Error("representation graph belongs to another DiagramSet");
  }
  if (input.projectId && input.projectId !== set.projectId) {
    throw new Error("representation graph belongs to another project");
  }
  const graph: RepresentationGraphRecord = {
    ...input,
    projectId: set.projectId,
    diagramSetId: setId,
    updatedAt: timestamp()
  };
  assertRepresentationGraph(graph);
  const workspace = await context.core.workspace();
  for (const layer of graph.layers) {
    const artifact = workspace.diagrams[layer.artifactRevision.artifactId]
      ?? workspace.diagramComponents[layer.artifactRevision.artifactId];
    if (!artifact || (artifact.diagramSetId !== setId && artifact.origin !== "imported")) {
      throw new Error(`representation layer references an unavailable artifact: ${layer.id}`);
    }
    const asciiSha256 = createHash("sha256").update(artifact.ascii).digest("hex");
    if (asciiSha256 !== layer.artifactRevision.asciiSha256) {
      throw new Error(`representation layer has a stale artifact revision: ${layer.id}`);
    }
    if (representationKindForArtifact(artifact) !== layer.representationKind) {
      throw new Error(`representation layer kind does not match its artifact: ${layer.id}`);
    }
  }
  await context.store.saveRepresentationGraph(graph);
  return context.core.workspace();
}

export async function addRepresentationFeedback(context: StudioContext, setId: string, input: { target: RepresentationFeedbackTarget; comment: string }): Promise<WorkspaceSnapshot> {
  const graph = await context.store.loadRepresentationGraph(setId);
  if (!graph) throw new Error("representation graph has not been created");
  const next = appendRepresentationFeedback(graph, {
    id: context.store.ids.representationFeedback(),
    target: input.target,
    comment: input.comment,
    createdAt: timestamp()
  });
  await context.store.saveRepresentationGraph({ ...next, updatedAt: timestamp() });
  return context.core.workspace();
}

export async function saveAgentSpatialProgress(context: StudioContext, setId: string, runId: string, state: SpatialProgressState): Promise<WorkspaceSnapshot> {
  const set = await context.store.loadDiagramSet(setId);
  if (!set.agentRunIds.includes(runId)) throw new Error("AgentRun does not belong to this DiagramSet");
  await context.store.loadRun(setId, runId);
  const workspace = await context.core.workspace();
  const artifactId = state.scope.revision.artifactId;
  const artifact = workspace.diagrams[artifactId] ?? workspace.diagramComponents[artifactId];
  if (!artifact) throw new Error(`spatial progress artifact was not found: ${artifactId}`);
  const representationKind = representationKindForArtifact(artifact);
  if (state.scope.representationKind !== representationKind) {
    throw new Error("spatial progress representation kind does not match the artifact");
  }
  const codeEntityMap = workspace.codeEntityMaps[`${setId}:${artifactId}`]
    ?? workspace.codeEntityMaps[artifactId];
  const index = buildRepresentationIndex({
    kind: representationKind,
    revision: {
      artifactId,
      asciiSha256: createHash("sha256").update(artifact.ascii).digest("hex")
    },
    ascii: artifact.ascii,
    codeEntityMap
  });
  assertSpatialProgressState(state, index);
  await context.store.saveSpatialProgress(runId, state);
  return context.core.workspace();
}
