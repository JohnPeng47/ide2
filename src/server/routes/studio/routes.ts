import type { ServerResponse } from "node:http";
import type { Connect } from "vite";
import type { StudioApplication } from "../../../../application/studio/application";
import type { DiagramSetWorkflow } from '../../../../application/studio/collection/diagramSetWorkflow';
import type { DatasetService } from '../../../../application/studio/datasets/datasetService';
import type { ExperimentRepository } from '../../../../application/studio/experiments/repository';
import {
  isDiagramViewKind,
  type CodeEntityMappingTarget,
  type GenerationDerivationRecord,
  type GenerationReferenceSelection
} from "../../../../domain/core/records/domain";
import { readBody, sendEvent, sendJson } from "../../http/http";

function parseGeneration(pathname: string): { setId: string } | null {
  const match = pathname.match(/^\/api\/studio\/diagram-sets\/([a-z0-9][a-z0-9-]*)\/generate$/);
  return match ? { setId: match[1] } : null;
}

function parseDiagramSet(pathname: string): { setId: string } | null {
  const match = pathname.match(/^\/api\/studio\/diagram-sets\/([a-z0-9][a-z0-9-]*)$/);
  return match ? { setId: match[1] } : null;
}

function parseRepresentationGraph(pathname: string): { setId: string; feedback: boolean } | null {
  const match = pathname.match(
    /^\/api\/studio\/diagram-sets\/([a-z0-9][a-z0-9-]*)\/representation-graph(\/feedback)?$/
  );
  return match ? { setId: match[1], feedback: Boolean(match[2]) } : null;
}

function parseSpatialProgress(pathname: string): { setId: string; runId: string } | null {
  const match = pathname.match(
    /^\/api\/studio\/diagram-sets\/([a-z0-9][a-z0-9-]*)\/agent-runs\/([a-z0-9][a-z0-9-]*)\/spatial-progress$/
  );
  return match ? { setId: match[1], runId: match[2] } : null;
}

function parseSystemPromptTemplate(pathname: string): { id: string; reset: boolean } | null {
  const match = pathname.match(/^\/api\/studio\/system-prompt-templates\/([a-z0-9][a-z0-9-]*)(\/reset)?$/);
  return match ? { id: match[1], reset: Boolean(match[2]) } : null;
}

function parseCodeEntityPromptTemplate(pathname: string): { id: string; reset: boolean } | null {
  const match = pathname.match(
    /^\/api\/studio\/code-entity-prompt-templates\/([a-z0-9][a-z0-9-]*)(\/reset)?$/
  );
  return match ? { id: match[1], reset: Boolean(match[2]) } : null;
}

function parseDiagram(pathname: string): { setId: string; diagramId: string } | null {
  const match = pathname.match(
    /^\/api\/studio\/diagram-sets\/([a-z0-9][a-z0-9-]*)\/diagrams\/([a-z0-9][a-z0-9-]*)$/
  );
  return match ? { setId: match[1], diagramId: match[2] } : null;
}

function parseDiagramArchive(pathname: string): { setId: string; diagramId: string } | null {
  const match = pathname.match(
    /^\/api\/studio\/diagram-sets\/([a-z0-9][a-z0-9-]*)\/diagrams\/([a-z0-9][a-z0-9-]*)\/archive$/
  );
  return match ? { setId: match[1], diagramId: match[2] } : null;
}

function parseDiagramStar(pathname: string): { setId: string; diagramId: string } | null {
  const match = pathname.match(
    /^\/api\/studio\/diagram-sets\/([a-z0-9][a-z0-9-]*)\/diagrams\/([a-z0-9][a-z0-9-]*)\/star$/
  );
  return match ? { setId: match[1], diagramId: match[2] } : null;
}

function parseDiagramCandidateFeedback(
  pathname: string
): { setId: string; candidateBatchId: string } | null {
  const match = pathname.match(
    /^\/api\/studio\/diagram-sets\/([a-z0-9][a-z0-9-]*)\/candidate-batches\/([a-z0-9][a-z0-9-]*)\/feedback$/
  );
  return match ? { setId: match[1], candidateBatchId: match[2] } : null;
}

function parseDiagramComponents(pathname: string): { setId: string; diagramId: string } | null {
  const match = pathname.match(
    /^\/api\/studio\/diagram-sets\/([a-z0-9][a-z0-9-]*)\/diagrams\/([a-z0-9][a-z0-9-]*)\/components$/
  );
  return match ? { setId: match[1], diagramId: match[2] } : null;
}

function parseCodeEntityMap(pathname: string): {
  setId: string;
  artifactKind: "diagram" | "diagram-component";
  artifactId: string;
} | null {
  const match = pathname.match(
    /^\/api\/studio\/diagram-sets\/([a-z0-9][a-z0-9-]*)\/(diagrams|components)\/([a-z0-9][a-z0-9-]*)\/code-entity-map$/
  );
  if (!match) return null;
  return {
    setId: match[1],
    artifactKind: match[2] === "diagrams" ? "diagram" : "diagram-component",
    artifactId: match[3]
  };
}

function parseCodeEntityMapBatch(pathname: string): { setId: string } | null {
  const match = pathname.match(
    /^\/api\/studio\/diagram-sets\/([a-z0-9][a-z0-9-]*)\/code-entity-maps$/
  );
  return match ? { setId: match[1] } : null;
}

function parseComponentAction(pathname: string): {
  setId: string;
  componentId: string;
  action: "archive" | "components";
} | null {
  const match = pathname.match(
    /^\/api\/studio\/diagram-sets\/([a-z0-9][a-z0-9-]*)\/components\/([a-z0-9][a-z0-9-]*)\/(archive|components)$/
  );
  return match
    ? { setId: match[1], componentId: match[2], action: match[3] as "archive" | "components" }
    : null;
}

function parseEditSessions(pathname: string): { setId: string } | null {
  const match = pathname.match(
    /^\/api\/studio\/diagram-sets\/([a-z0-9][a-z0-9-]*)\/edit-sessions$/
  );
  return match ? { setId: match[1] } : null;
}

function parseEditSessionAction(pathname: string): {
  setId: string;
  sessionId: string;
  action: "manual" | "marker" | "llm" | "undo" | "redo" | "finish" | "discard";
} | null {
  const match = pathname.match(
    /^\/api\/studio\/diagram-sets\/([a-z0-9][a-z0-9-]*)\/edit-sessions\/([a-z0-9][a-z0-9-]*)\/(manual|marker|llm|undo|redo|finish|discard)$/
  );
  return match ? {
    setId: match[1],
    sessionId: match[2],
    action: match[3] as "manual" | "marker" | "llm" | "undo" | "redo" | "finish" | "discard"
  } : null;
}

function parseExperimentArtifact(pathname: string): { catalogId: string } | null {
  const match = pathname.match(/^\/api\/studio\/experiments\/([a-z0-9][a-z0-9-]{0,127})\/artifact$/);
  return match ? { catalogId: match[1] } : null;
}

function parseDatasetItems(pathname: string): { datasetId: string } | null {
  const match = pathname.match(/^\/api\/studio\/diagram-datasets\/([a-z0-9][a-z0-9-]{0,127})\/items$/);
  return match ? { datasetId: match[1] } : null;
}

function parseDatasetItem(pathname: string): { datasetId: string; itemId: string } | null {
  const match = pathname.match(/^\/api\/studio\/diagram-datasets\/([a-z0-9][a-z0-9-]{0,127})\/items\/([a-z0-9][a-z0-9-]{0,127})$/);
  return match ? { datasetId: match[1], itemId: match[2] } : null;
}
export function createStudioRoutes({ application, experimentCatalog, datasetStore, creationWorkflow }: {
  application: StudioApplication;
  experimentCatalog: ExperimentRepository; datasetStore: DatasetService; creationWorkflow: DiagramSetWorkflow;
}) {
  return async (request: Connect.IncomingMessage, response: ServerResponse, url: URL): Promise<void> => {

    if (url.pathname === "/api/studio/experiments") {
      if (request.method !== "GET") return sendJson(response, 405, { error: "method not allowed" });
      return sendJson(response, 200, await experimentCatalog.list());
    }

    if (url.pathname === "/api/studio/diagram-datasets") {
      if (request.method === "GET") return sendJson(response, 200, await datasetStore.list());
      if (request.method !== "POST") return sendJson(response, 405, { error: "method not allowed" });
      const body = await readBody(request) as Record<string, unknown>;
      return sendJson(response, 201, await datasetStore.create(body.name));
    }

    const datasetItem = parseDatasetItem(url.pathname);

    if (datasetItem) {
      if (request.method === "GET") {
        return sendJson(response, 200, await datasetStore.item(datasetItem.datasetId, datasetItem.itemId));
      }
      if (request.method === "PATCH") {
        const body = await readBody(request) as Record<string, unknown>;
        return sendJson(response, 200, await datasetStore.updateLabels(datasetItem.datasetId, datasetItem.itemId, body.labels));
      }
      if (request.method === "DELETE") {
        return sendJson(response, 200, await datasetStore.removeItem(datasetItem.datasetId, datasetItem.itemId));
      }
      return sendJson(response, 405, { error: "method not allowed" });
    }

    const datasetItems = parseDatasetItems(url.pathname);

    if (datasetItems) {
      if (request.method !== "POST") return sendJson(response, 405, { error: "method not allowed" });
      const body = await readBody(request) as Record<string, unknown>;
      return sendJson(response, 200, await datasetStore.addFromExperiment(datasetItems.datasetId, body));
    }

    const experimentArtifact = parseExperimentArtifact(url.pathname);

    if (experimentArtifact) {
      if (request.method !== "GET") return sendJson(response, 405, { error: "method not allowed" });
      return sendJson(response, 200, await experimentCatalog.artifact({
        catalogId: experimentArtifact.catalogId,
        axisId: url.searchParams.get("axis") ?? "",
        iteration: Number(url.searchParams.get("iteration")),
        value: Number(url.searchParams.get("value")),
        replicate: Number(url.searchParams.get("replicate"))
      }));
    }

    if (url.pathname === "/api/studio/project/representations/promote") {
      if (request.method !== "POST") return sendJson(response, 405, { error: "method not allowed" });
      const body = await readBody(request) as Record<string, unknown>;
      if (typeof body.diagramSetId !== "string" || typeof body.diagramId !== "string") {
        return sendJson(response, 400, { error: "diagramSetId and diagramId are required" });
      }
      return sendJson(response, 201, await application.promoteProjectRepresentation({
        diagramSetId: body.diagramSetId,
        diagramId: body.diagramId,
        ...(typeof body.representationId === "string"
          ? { representationId: body.representationId }
          : {}),
        ...(typeof body.expectedRevisionId === "string" ? { expectedRevisionId: body.expectedRevisionId } : {}),
        ...(typeof body.makeActive === "boolean" ? { makeActive: body.makeActive } : {})
      }));
    }

    const representationGraph = parseRepresentationGraph(url.pathname);

    if (representationGraph) {
      if (request.method !== "PUT" && request.method !== "POST" && request.method !== "GET") {
        return sendJson(response, 405, { error: "method not allowed" });
      }
      if (!representationGraph.feedback && request.method === "GET") {
        const graph = await application.representationGraph(representationGraph.setId);
        return graph
          ? sendJson(response, 200, graph)
          : sendJson(response, 404, { error: "representation graph not found" });
      }
      const body = await readBody(request) as Record<string, unknown>;
      if (representationGraph.feedback) {
        if (request.method !== "POST") return sendJson(response, 405, { error: "method not allowed" });
        const target = body.target as { kind?: unknown; layerId?: unknown; transitionId?: unknown } | undefined;
        const normalizedTarget = target?.kind === "layer" && typeof target.layerId === "string"
          ? { kind: "layer" as const, layerId: target.layerId }
          : target?.kind === "transition" && typeof target.transitionId === "string"
            ? { kind: "transition" as const, transitionId: target.transitionId }
            : null;
        if (!normalizedTarget || typeof body.comment !== "string") {
          return sendJson(response, 400, { error: "feedback target and comment are required" });
        }
        return sendJson(response, 201, await application.addRepresentationFeedback(
          representationGraph.setId,
          { target: normalizedTarget, comment: body.comment }
        ));
      }
      if (request.method !== "PUT") return sendJson(response, 405, { error: "method not allowed" });
      return sendJson(response, 200, await application.saveRepresentationGraph(
        representationGraph.setId,
        body as unknown as import("../../../../domain/core/representations/representationGraph").RepresentationGraphRecord
      ));
    }

    const spatialProgress = parseSpatialProgress(url.pathname);

    if (spatialProgress) {
      if (request.method !== "PUT") return sendJson(response, 405, { error: "method not allowed" });
      const body = await readBody(request);
      return sendJson(response, 200, await application.saveAgentSpatialProgress(
        spatialProgress.setId,
        spatialProgress.runId,
        body as import("../../../../domain/core/agent-work/agentWork").SpatialProgressState
      ));
    }

    if (url.pathname === "/api/studio/system-prompt-templates") {
      if (request.method === "GET") {
        return sendJson(response, 200, { templates: await application.systemPromptTemplates() });
      }
      if (request.method !== "POST") return sendJson(response, 405, { error: "method not allowed" });
      const body = await readBody(request) as Record<string, unknown>;
      return sendJson(response, 200, await application.saveSystemPromptTemplate({
        label: body.label,
        description: body.description,
        prompts: body.prompts
      }));
    }

    if (url.pathname === "/api/studio/code-entity-prompt-templates") {
      if (request.method === "GET") {
        return sendJson(response, 200, { templates: await application.codeEntityPromptTemplates() });
      }
      if (request.method !== "POST") return sendJson(response, 405, { error: "method not allowed" });
      const body = await readBody(request) as Record<string, unknown>;
      return sendJson(response, 200, await application.saveCodeEntityPromptTemplate({
        label: body.label,
        description: body.description,
        prompts: body.prompts
      }));
    }

    const codeEntityPromptTemplate = parseCodeEntityPromptTemplate(url.pathname);

    if (codeEntityPromptTemplate) {
      if (codeEntityPromptTemplate.reset) {
        if (request.method !== "POST") return sendJson(response, 405, { error: "method not allowed" });
        return sendJson(
          response,
          200,
          await application.resetCodeEntityPromptTemplate(codeEntityPromptTemplate.id)
        );
      }
      if (request.method === "DELETE") {
        return sendJson(
          response,
          200,
          await application.deleteCodeEntityPromptTemplate(codeEntityPromptTemplate.id)
        );
      }
      if (request.method !== "PUT") return sendJson(response, 405, { error: "method not allowed" });
      const body = await readBody(request) as Record<string, unknown>;
      return sendJson(response, 200, await application.saveCodeEntityPromptTemplate({
        id: codeEntityPromptTemplate.id,
        label: body.label,
        description: body.description,
        prompts: body.prompts
      }));
    }

    const systemPromptTemplate = parseSystemPromptTemplate(url.pathname);

    if (systemPromptTemplate) {
      if (systemPromptTemplate.reset) {
        if (request.method !== "POST") return sendJson(response, 405, { error: "method not allowed" });
        return sendJson(
          response,
          200,
          await application.resetSystemPromptTemplate(systemPromptTemplate.id)
        );
      }
      if (request.method === "DELETE") {
        return sendJson(
          response,
          200,
          await application.deleteSystemPromptTemplate(systemPromptTemplate.id)
        );
      }
      if (request.method !== "PUT") return sendJson(response, 405, { error: "method not allowed" });
      const body = await readBody(request) as Record<string, unknown>;
      return sendJson(response, 200, await application.saveSystemPromptTemplate({
        id: systemPromptTemplate.id,
        label: body.label,
        description: body.description,
        prompts: body.prompts
      }));
    }

    if (url.pathname === "/api/studio/diagram-sets") {
      if (request.method !== "POST") return sendJson(response, 405, { error: "method not allowed" });
      const body = await readBody(request) as Record<string, unknown>;
      const prepared = await creationWorkflow.prepare(body);
      response.statusCode = 200;
      response.setHeader("content-type", "application/x-ndjson; charset=utf-8");
      response.setHeader("cache-control", "no-cache, no-transform");
      response.flushHeaders();
      await creationWorkflow.run(prepared, event => sendEvent(response, event));
      if (!response.destroyed && !response.writableEnded) response.end();
      return;
    }

    const diagramSet = parseDiagramSet(url.pathname);

    if (diagramSet) {
      if (request.method !== "DELETE") return sendJson(response, 405, { error: "method not allowed" });
      return sendJson(response, 200, await application.deleteDiagramSet(diagramSet.setId));
    }

    const archive = parseDiagramArchive(url.pathname);

    if (archive) {
      if (request.method !== "POST") return sendJson(response, 405, { error: "method not allowed" });
      return sendJson(
        response,
        200,
        await application.archiveDiagram(archive.setId, archive.diagramId)
      );
    }

    const diagramStar = parseDiagramStar(url.pathname);

    if (diagramStar) {
      if (request.method !== "POST") return sendJson(response, 405, { error: "method not allowed" });
      const body = await readBody(request) as Record<string, unknown>;
      if (typeof body.starred !== "boolean") {
        return sendJson(response, 400, { error: "starred must be a boolean" });
      }
      return sendJson(
        response,
        200,
        await application.setStarredDiagram(
          diagramStar.setId,
          diagramStar.diagramId,
          body.starred
        )
      );
    }

    const candidateFeedback = parseDiagramCandidateFeedback(url.pathname);

    if (candidateFeedback) {
      if (request.method !== "PUT") return sendJson(response, 405, { error: "method not allowed" });
      const body = await readBody(request) as Record<string, unknown>;
      if (!Array.isArray(body.rankings) || !body.rankings.every((value) => {
        if (!value || typeof value !== "object") return false;
        const ranking = value as Record<string, unknown>;
        return typeof ranking.diagramId === "string" && typeof ranking.rank === "number";
      })) {
        return sendJson(response, 400, {
          error: "rankings must contain a diagramId and numerical rank for every candidate"
        });
      }
      return sendJson(
        response,
        200,
        await application.rankDiagramCandidates(
          candidateFeedback.setId,
          candidateFeedback.candidateBatchId,
          body.rankings as Array<{ diagramId: string; rank: number }>
        )
      );
    }

    const codeEntityMapBatch = parseCodeEntityMapBatch(url.pathname);

    if (codeEntityMapBatch) {
      if (request.method !== "POST") return sendJson(response, 405, { error: "method not allowed" });
      const body = await readBody(request) as Record<string, unknown>;
      const artifacts = Array.isArray(body.artifacts)
        ? body.artifacts.flatMap((value): CodeEntityMappingTarget[] => {
          if (!value || typeof value !== "object") return [];
          const target = value as Record<string, unknown>;
          if ((target.artifactKind !== "diagram" && target.artifactKind !== "diagram-component")
            || typeof target.artifactId !== "string" || !target.artifactId.trim()) return [];
          return [{ artifactKind: target.artifactKind, artifactId: target.artifactId }];
        })
        : [];
      if (!Array.isArray(body.artifacts) || artifacts.length !== body.artifacts.length) {
        return sendJson(response, 400, {
          error: "artifacts must contain an artifactKind and artifactId for every target"
        });
      }
      if (artifacts.length === 0) {
        return sendJson(response, 400, { error: "at least one artifact is required for mapping" });
      }
      const concurrency = body.concurrency === undefined ? 3 : Number(body.concurrency);
      if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 6) {
        return sendJson(response, 400, { error: "mapping concurrency must be between 1 and 6" });
      }
      response.statusCode = 200;
      response.setHeader("content-type", "application/x-ndjson; charset=utf-8");
      response.setHeader("cache-control", "no-cache, no-transform");
      response.flushHeaders();
      const result = await application.mapCodeEntitiesBatch(
        codeEntityMapBatch.setId,
        artifacts,
        concurrency,
        (event) => sendEvent(response, event)
      );
      sendEvent(response, { type: "result", ...result });
      response.end();
      return;
    }

    const codeEntityMap = parseCodeEntityMap(url.pathname);

    if (codeEntityMap) {
      if (request.method !== "POST") return sendJson(response, 405, { error: "method not allowed" });
      response.statusCode = 200;
      response.setHeader("content-type", "application/x-ndjson; charset=utf-8");
      response.setHeader("cache-control", "no-cache, no-transform");
      response.flushHeaders();
      const workspace = await application.mapCodeEntities(
        codeEntityMap.setId,
        codeEntityMap.artifactKind,
        codeEntityMap.artifactId,
        (event) => sendEvent(response, event)
      );
      sendEvent(response, { type: "result", workspace });
      response.end();
      return;
    }

    const editSessions = parseEditSessions(url.pathname);

    if (editSessions) {
      if (request.method !== "POST") return sendJson(response, 405, { error: "method not allowed" });
      const body = await readBody(request) as Record<string, unknown>;
      const artifactKind = body.artifactKind;
      const artifactId = typeof body.artifactId === "string" ? body.artifactId : "";
      if ((artifactKind !== "diagram" && artifactKind !== "diagram-component") || !artifactId) {
        return sendJson(response, 400, { error: "artifactKind and artifactId are required" });
      }
      return sendJson(
        response,
        200,
        await application.createEditSession(editSessions.setId, artifactKind, artifactId)
      );
    }

    const editAction = parseEditSessionAction(url.pathname);

    if (editAction) {
      if (request.method !== "POST") return sendJson(response, 405, { error: "method not allowed" });
      const body = await readBody(request) as Record<string, unknown>;
      if (editAction.action === "manual") {
        const ascii = typeof body.ascii === "string" ? body.ascii : "";
        return sendJson(response, 200, await application.manualEdit(
          editAction.setId, editAction.sessionId, ascii
        ));
      }
      if (editAction.action === "marker") {
        return sendJson(response, 200, await application.placeEditMarker(
          editAction.setId,
          editAction.sessionId,
          Number(body.line),
          Number(body.column)
        ));
      }
      if (editAction.action === "undo") {
        return sendJson(response, 200, await application.undoEdit(editAction.setId, editAction.sessionId));
      }
      if (editAction.action === "redo") {
        return sendJson(response, 200, await application.redoEdit(editAction.setId, editAction.sessionId));
      }
      if (editAction.action === "finish") {
        return sendJson(response, 200, await application.finishEdit(editAction.setId, editAction.sessionId));
      }
      if (editAction.action === "discard") {
        return sendJson(response, 200, await application.discardEdit(editAction.setId, editAction.sessionId));
      }
      const instruction = typeof body.instruction === "string" ? body.instruction : "";
      const modelId = typeof body.modelId === "string" ? body.modelId : undefined;
      response.statusCode = 200;
      response.setHeader("content-type", "application/x-ndjson; charset=utf-8");
      response.setHeader("cache-control", "no-cache, no-transform");
      response.flushHeaders();
      const workspace = await application.llmEdit(
        editAction.setId,
        editAction.sessionId,
        instruction,
        modelId,
        (event) => sendEvent(response, event)
      );
      sendEvent(response, { type: "result", workspace });
      response.end();
      return;
    }

    const componentAction = parseComponentAction(url.pathname);

    if (componentAction) {
      if (request.method !== "POST") return sendJson(response, 405, { error: "method not allowed" });
      if (componentAction.action === "archive") {
        return sendJson(
          response,
          200,
          await application.archiveDiagramComponent(
            componentAction.setId,
            componentAction.componentId
          )
        );
      }
      const body = await readBody(request) as Record<string, unknown>;
      const bounds = body.bounds as Record<string, unknown> | undefined;
      if (!bounds) return sendJson(response, 400, { error: "selection bounds are required" });
      return sendJson(
        response,
        200,
        await application.captureNestedDiagramComponent(
          componentAction.setId,
          componentAction.componentId,
          {
            startLine: Number(bounds.startLine),
            endLine: Number(bounds.endLine),
            startColumn: Number(bounds.startColumn),
            endColumn: Number(bounds.endColumn)
          }
        )
      );
    }

    const componentCapture = parseDiagramComponents(url.pathname);

    if (componentCapture) {
      if (request.method !== "POST") return sendJson(response, 405, { error: "method not allowed" });
      const body = await readBody(request) as Record<string, unknown>;
      const bounds = body.bounds as Record<string, unknown> | undefined;
      if (!bounds) return sendJson(response, 400, { error: "selection bounds are required" });
      return sendJson(
        response,
        200,
        await application.captureDiagramComponent(componentCapture.setId, componentCapture.diagramId, {
          startLine: Number(bounds.startLine),
          endLine: Number(bounds.endLine),
          startColumn: Number(bounds.startColumn),
          endColumn: Number(bounds.endColumn)
        })
      );
    }

    const diagram = parseDiagram(url.pathname);

    if (diagram) {
      if (request.method !== "PATCH") return sendJson(response, 405, { error: "method not allowed" });
      const body = await readBody(request) as Record<string, unknown>;
      const name = typeof body.name === "string" ? body.name : "";
      return sendJson(
        response,
        200,
        await application.renameDiagram(diagram.setId, diagram.diagramId, name)
      );
    }

    const generation = parseGeneration(url.pathname);

    if (!generation) return sendJson(response, 404, { error: "API route not found" });

    if (request.method !== "POST") return sendJson(response, 405, { error: "method not allowed" });

    const body = await readBody(request) as Record<string, unknown>;

    const count = Number(body.count);

    const prompt = typeof body.prompt === "string" ? body.prompt : "";

    const selectedCodeEntityIds = Array.isArray(body.selectedCodeEntityIds)
      ? body.selectedCodeEntityIds.filter((value): value is string => typeof value === "string")
      : [];

    const outputKind = body.outputKind;

    const viewKind = body.viewKind;

    const modelId = typeof body.modelId === "string" ? body.modelId : undefined;

    const promptProfileId = typeof body.promptProfileId === "string"
      ? body.promptProfileId
      : undefined;

    const parseReferenceSelections = (value: unknown): GenerationReferenceSelection[] | undefined => (
      Array.isArray(value)
        ? value.slice(0, 200).flatMap((entry) => {
          if (!entry || typeof entry !== "object") return [];
          const selection = entry as Record<string, unknown>;
          const kind = selection.kind;
          if (kind !== "code-entity" && kind !== "diagram" && kind !== "diagram-component") return [];
          if (typeof selection.targetId !== "string"
            || typeof selection.token !== "string"
            || typeof selection.handle !== "string"
            || typeof selection.included !== "boolean") return [];
          return [{
            kind,
            targetId: selection.targetId,
            token: selection.token,
            handle: selection.handle,
            included: selection.included
          }];
        })
        : undefined
    );

    const referenceSelections = parseReferenceSelections(body.referenceSelections);

    const referencePrompt = typeof body.referencePrompt === "string" ? body.referencePrompt : undefined;

    const referencePromptSelections = parseReferenceSelections(body.referencePromptSelections);

    const rawDerivation = body.derivation;

    const derivation: GenerationDerivationRecord | undefined = rawDerivation && typeof rawDerivation === "object"
      ? (() => {
        const candidate = rawDerivation as Record<string, unknown>;
        if ((candidate.sourceArtifactKind !== "diagram"
          && candidate.sourceArtifactKind !== "diagram-component")
          || typeof candidate.sourceArtifactId !== "string"
          || typeof candidate.promptCorrection !== "string") return undefined;
        return {
          sourceArtifactKind: candidate.sourceArtifactKind,
          sourceArtifactId: candidate.sourceArtifactId,
          promptCorrection: candidate.promptCorrection
        };
      })()
      : undefined;

    if (outputKind !== "diagram" && outputKind !== "diagram-component") {
      return sendJson(response, 400, { error: "outputKind must be diagram or diagram-component" });
    }

    if (outputKind === "diagram" && !isDiagramViewKind(viewKind ?? "diagram")) {
      return sendJson(response, 400, { error: "viewKind must be diagram, call-graph, or dir-view" });
    }

    if (outputKind === "diagram-component" && viewKind !== undefined) {
      return sendJson(response, 400, { error: "viewKind is not valid for DiagramComponents" });
    }

    const diagramViewKind = isDiagramViewKind(viewKind) ? viewKind : "diagram";

    response.statusCode = 200;

    response.setHeader("content-type", "application/x-ndjson; charset=utf-8");

    response.setHeader("cache-control", "no-cache, no-transform");

    response.flushHeaders();

    const workspace = await application.generate(generation.setId, {
      prompt,
      selectedCodeEntityIds,
      count,
      outputKind,
      ...(outputKind === "diagram" ? { viewKind: diagramViewKind } : {}),
      modelId,
      promptProfileId,
      referenceSelections,
      referencePrompt,
      referencePromptSelections,
      derivation
    }, (event) => sendEvent(response, event));

    sendEvent(response, { type: "result", workspace });

    response.end();

  };
}
