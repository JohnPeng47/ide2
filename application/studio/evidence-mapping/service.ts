import { createHash } from "node:crypto";
import {
  createSpatialProgressState,
  representationElementIds,
  updateSpatialProgressState
} from "../../../domain/core/agent-work/agentWork";
import { validateDiagramMappings } from "../../../domain/core/diagrams/diagramMapping";
import { representationKindForArtifact } from "../../../domain/core/profiles/domainProfiles";
import {
  SCHEMA_VERSION,
  type AgentProgress,
  type AgentRunRecord,
  type CodeEntityMappingResult,
  type CodeEntityMappingTarget,
  type DiagramCodeEntityMapRecord,
  type GenerationOutputKind,
  type WorkspaceSnapshot
} from "../../../domain/core/records/domain";
import { buildRepresentationIndex } from "../../../domain/core/representations/representationIndex";
import type { StudioContext } from '../context';
import { ServiceEvent, timestamp } from '../shared';

export async function mapCodeEntities(context: StudioContext, setId: string, artifactKind: GenerationOutputKind, artifactId: string, onEvent?: (event: ServiceEvent) => void): Promise<WorkspaceSnapshot> {
  const batch = await mapCodeEntitiesBatch(context,
    setId,
    [{ artifactKind, artifactId }],
    1,
    onEvent
  );
  const failed = batch.results[0];
  if (failed?.status === "failed") throw new Error(failed.error ?? "code-entity mapping failed");
  return batch.workspace;
}

export async function mapCodeEntitiesBatch(context: StudioContext, setId: string, targets: CodeEntityMappingTarget[], concurrency = 3, onEvent?: (event: ServiceEvent) => void): Promise<{ workspace: WorkspaceSnapshot; results: CodeEntityMappingResult[] }> {
  if (targets.length === 0) throw new Error("at least one artifact is required for mapping");
  if (targets.length > 50) throw new Error("a mapping batch cannot exceed 50 artifacts");
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 6) {
    throw new Error("mapping concurrency must be between 1 and 6");
  }
  const targetKeys = targets.map(({ artifactKind, artifactId }) => `${artifactKind}:${artifactId}`);
  if (new Set(targetKeys).size !== targetKeys.length) {
    throw new Error("a mapping batch cannot contain duplicate artifacts");
  }
  const set = await context.store.loadDiagramSet(setId);
  const { domainProfileId } = await context.core.projectCorpus(set);
  const entitySet = await context.store.loadCodeEntities(setId);
  if (entitySet.status !== "finalized") {
    throw new Error("CodeEntitiesSet must be finalized before mapping");
  }
  const prepared = await Promise.all(targets.map(async (target) => {
    if (target.artifactKind !== "diagram" && target.artifactKind !== "diagram-component") {
      throw new Error(`unsupported artifact kind: ${String(target.artifactKind)}`);
    }
    const bundle = await context.core.mappedArtifactBundle(setId, target.artifactKind, target.artifactId);
    if (bundle.artifact.archivedAt) throw new Error("archived artifacts cannot be mapped");
    if (bundle.codeEntities.length === 0) throw new Error("artifact has no CodeEntities to map");
    const mappingKey = `${setId}:${target.artifactId}`;
    if (context.activeMappings.has(mappingKey)) {
      throw new Error(`a code-entity mapping is already running for ${target.artifactId}`);
    }
    const createdAt = timestamp();
    const run: AgentRunRecord = {
      schemaVersion: SCHEMA_VERSION,
      id: context.store.ids.run(),
      diagramSetId: setId,
      kind: "map-code-entities",
      status: "queued",
      statusMessage: "queued diagram mapping agent",
      codeEntitiesRevision: entitySet.revision,
      outputCodeEntityIds: bundle.codeEntities.map((entity) => entity.id),
      ...(target.artifactKind === "diagram"
        ? { outputDiagramId: target.artifactId }
        : { outputDiagramComponentId: target.artifactId }),
      startedAt: createdAt,
      updatedAt: createdAt
    };
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
    const spatialProgress = createSpatialProgressState({
      revision,
      representationKind,
      target: { kind: "artifact" }
    }, representationIndex);
    return {
      target,
      mappingKey,
      artifact: bundle.artifact,
      entities: bundle.codeEntities,
      run,
      representationIndex,
      spatialProgress
    };
  }));

  const conflictingJob = prepared.find((job) => context.activeMappings.has(job.mappingKey));
  if (conflictingJob) {
    throw new Error(
      `a code-entity mapping is already running for ${conflictingJob.target.artifactId}`
    );
  }
  for (const job of prepared) context.activeMappings.add(job.mappingKey);
  try {
    await Promise.all(prepared.flatMap((job) => [
      context.store.saveRun(job.run),
      context.store.saveSpatialProgress(job.run.id, job.spatialProgress)
    ]));
    await context.store.attachRuns(setId, prepared.map((job) => job.run.id));
    for (const job of prepared) onEvent?.({
      type: "progress",
      artifactKind: job.target.artifactKind,
      artifactId: job.target.artifactId,
      status: "queued",
      message: "queued code-entity mapping"
    });

    const results: CodeEntityMappingResult[] = new Array(prepared.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < prepared.length) {
        const index = cursor;
        cursor += 1;
        const job = prepared[index];
        let run = job.run;
        let spatialProgress = updateSpatialProgressState(job.spatialProgress, {
          status: "running",
          currentElementIds: representationElementIds(job.representationIndex)
        }, job.representationIndex);
        await context.store.saveSpatialProgress(run.id, spatialProgress);
        let progressWrites = Promise.resolve();
        const progress = (update: AgentProgress) => {
          run = {
            ...run,
            status: update.status,
            statusMessage: update.message,
            model: update.model ?? run.model,
            sessionId: update.sessionId ?? run.sessionId,
            updatedAt: timestamp()
          };
          const snapshot = run;
          progressWrites = progressWrites.then(() => context.store.saveRun(snapshot));
          onEvent?.({
            type: "progress",
            artifactKind: job.target.artifactKind,
            artifactId: job.target.artifactId,
            status: update.status,
            message: update.message
          });
        };
        try {
          const drafts = await context.agents.mapArtifactEntities({
            sourceRoot: set.sourceCheckoutRoot,
            diagramSetName: set.name,
            artifactKind: job.target.artifactKind,
            artifactName: job.artifact.name,
            artifactHandle: job.artifact.handle,
            ascii: job.artifact.ascii,
            codeEntityIds: job.artifact.codeEntityIds,
            codeEntities: job.entities,
            domainProfileId
          }, progress);
          await progressWrites;
          const mappings = validateDiagramMappings(job.artifact.ascii, drafts, job.entities);
          const record: DiagramCodeEntityMapRecord = {
            schemaVersion: SCHEMA_VERSION,
            diagramSetId: setId,
            artifactKind: job.target.artifactKind,
            artifactId: job.target.artifactId,
            asciiSha256: createHash("sha256").update(job.artifact.ascii).digest("hex"),
            mappings,
            producedByRunId: run.id,
            origin: "agent",
            createdAt: timestamp()
          };
          await context.store.saveCodeEntityMap(record);
          const completedIndex = buildRepresentationIndex({
            kind: job.spatialProgress.scope.representationKind,
            revision: job.spatialProgress.scope.revision,
            ascii: job.artifact.ascii,
            codeEntityMap: record
          });
          spatialProgress = createSpatialProgressState(job.spatialProgress.scope, completedIndex);
          const completedElementIds = representationElementIds(completedIndex);
          spatialProgress = updateSpatialProgressState(spatialProgress, {
            status: "running",
            currentElementIds: completedElementIds
          }, completedIndex);
          spatialProgress = updateSpatialProgressState(spatialProgress, {
            status: "complete",
            completedElementIds
          }, completedIndex);
          await context.store.saveSpatialProgress(run.id, spatialProgress);
          const completedAt = timestamp();
          run = {
            ...run,
            status: "complete",
            statusMessage: `mapped ${mappings.length} diagram elements`,
            updatedAt: completedAt,
            completedAt
          };
          await context.store.saveRun(run);
          results[index] = {
            ...job.target,
            status: "complete",
            mappingCount: mappings.length
          };
          onEvent?.({
            type: "progress",
            ...job.target,
            status: "complete",
            message: run.statusMessage
          });
        } catch (error) {
          await progressWrites.catch(() => undefined);
          const message = error instanceof Error ? error.message : "code-entity mapping failed";
          const completedAt = timestamp();
          run = {
            ...run,
            status: "failed",
            statusMessage: message,
            error: message,
            updatedAt: completedAt,
            completedAt
          };
          await context.store.saveRun(run);
          spatialProgress = updateSpatialProgressState(
            createSpatialProgressState(job.spatialProgress.scope, job.representationIndex), {
            status: "failed",
            error: message
          }, job.representationIndex
          );
          await context.store.saveSpatialProgress(run.id, spatialProgress);
          results[index] = { ...job.target, status: "failed", error: message };
          onEvent?.({
            type: "progress",
            ...job.target,
            status: "failed",
            message
          });
        }
      }
    };
    await Promise.all(Array.from(
      { length: Math.min(concurrency, prepared.length) },
      () => worker()
    ));
    const workspace = await context.core.workspace();
    const completeCount = results.filter((result) => result.status === "complete").length;
    onEvent?.({
      type: "workspace",
      message: `mapped ${completeCount} of ${results.length} artifacts`,
      workspace
    });
    return { workspace, results };
  } finally {
    for (const job of prepared) context.activeMappings.delete(job.mappingKey);
  }
}
