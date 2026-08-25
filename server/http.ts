import type { ServerResponse } from "node:http";
import type { Connect, Plugin } from "vite";
import {
  isDiagramViewKind,
  type ArtifactImportInput,
  type GenerationDerivationRecord,
  type GenerationReferenceSelection
} from "../src/domain";
import { FakeDiagramAgentRuntime, PiDiagramAgentRuntime } from "./agentRuntime";
import { DiagramApplication } from "./application";
import { DiagramDatasetStore } from "./diagramDatasetStore";
import { ExperimentCatalog } from "./experimentCatalog";
import { DiagramStore } from "./store";

const MAX_REQUEST_BYTES = 10 * 1024 * 1024;

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function sendEvent(response: ServerResponse, payload: unknown): void {
  if (!response.destroyed && !response.writableEnded) {
    response.write(`${JSON.stringify(payload)}\n`);
  }
}

function readBody(request: Connect.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) {
        reject(new Error("request is too large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("request body is not valid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function parseGeneration(pathname: string): { setId: string } | null {
  const match = pathname.match(/^\/api\/diagram-sets\/([a-z0-9][a-z0-9-]*)\/generate$/);
  return match ? { setId: match[1] } : null;
}

function parseDiagramSet(pathname: string): { setId: string } | null {
  const match = pathname.match(/^\/api\/diagram-sets\/([a-z0-9][a-z0-9-]*)$/);
  return match ? { setId: match[1] } : null;
}

function parseRepositoryFiles(pathname: string): { setId: string } | null {
  const match = pathname.match(/^\/api\/diagram-sets\/([a-z0-9][a-z0-9-]*)\/files$/);
  return match ? { setId: match[1] } : null;
}

function parseSystemPromptTemplate(pathname: string): { id: string; reset: boolean } | null {
  const match = pathname.match(/^\/api\/system-prompt-templates\/([a-z0-9][a-z0-9-]*)(\/reset)?$/);
  return match ? { id: match[1], reset: Boolean(match[2]) } : null;
}

function parseCodeEntityPromptTemplate(pathname: string): { id: string; reset: boolean } | null {
  const match = pathname.match(
    /^\/api\/code-entity-prompt-templates\/([a-z0-9][a-z0-9-]*)(\/reset)?$/
  );
  return match ? { id: match[1], reset: Boolean(match[2]) } : null;
}

function parseImportedDiagram(pathname: string): { diagramId: string; archive: boolean } | null {
  const match = pathname.match(/^\/api\/imports\/diagrams\/([a-z0-9][a-z0-9-]*)(\/archive)?$/);
  return match ? { diagramId: match[1], archive: Boolean(match[2]) } : null;
}

function parseImportedDiagramComponent(
  pathname: string
): { componentId: string; archive: boolean } | null {
  const match = pathname.match(
    /^\/api\/imports\/diagram-components\/([a-z0-9][a-z0-9-]*)(\/archive)?$/
  );
  return match ? { componentId: match[1], archive: Boolean(match[2]) } : null;
}

function parseDiagram(pathname: string): { setId: string; diagramId: string } | null {
  const match = pathname.match(
    /^\/api\/diagram-sets\/([a-z0-9][a-z0-9-]*)\/diagrams\/([a-z0-9][a-z0-9-]*)$/
  );
  return match ? { setId: match[1], diagramId: match[2] } : null;
}

function parseDiagramArchive(pathname: string): { setId: string; diagramId: string } | null {
  const match = pathname.match(
    /^\/api\/diagram-sets\/([a-z0-9][a-z0-9-]*)\/diagrams\/([a-z0-9][a-z0-9-]*)\/archive$/
  );
  return match ? { setId: match[1], diagramId: match[2] } : null;
}

function parseDiagramStar(pathname: string): { setId: string; diagramId: string } | null {
  const match = pathname.match(
    /^\/api\/diagram-sets\/([a-z0-9][a-z0-9-]*)\/diagrams\/([a-z0-9][a-z0-9-]*)\/star$/
  );
  return match ? { setId: match[1], diagramId: match[2] } : null;
}

function parseDiagramComponents(pathname: string): { setId: string; diagramId: string } | null {
  const match = pathname.match(
    /^\/api\/diagram-sets\/([a-z0-9][a-z0-9-]*)\/diagrams\/([a-z0-9][a-z0-9-]*)\/components$/
  );
  return match ? { setId: match[1], diagramId: match[2] } : null;
}

function parseCodeEntityMap(pathname: string): {
  setId: string;
  artifactKind: "diagram" | "diagram-component";
  artifactId: string;
} | null {
  const match = pathname.match(
    /^\/api\/diagram-sets\/([a-z0-9][a-z0-9-]*)\/(diagrams|components)\/([a-z0-9][a-z0-9-]*)\/code-entity-map$/
  );
  if (!match) return null;
  return {
    setId: match[1],
    artifactKind: match[2] === "diagrams" ? "diagram" : "diagram-component",
    artifactId: match[3]
  };
}

function parseComponentAction(pathname: string): {
  setId: string;
  componentId: string;
  action: "archive" | "components";
} | null {
  const match = pathname.match(
    /^\/api\/diagram-sets\/([a-z0-9][a-z0-9-]*)\/components\/([a-z0-9][a-z0-9-]*)\/(archive|components)$/
  );
  return match
    ? { setId: match[1], componentId: match[2], action: match[3] as "archive" | "components" }
    : null;
}

function parseEditSessions(pathname: string): { setId: string } | null {
  const match = pathname.match(
    /^\/api\/diagram-sets\/([a-z0-9][a-z0-9-]*)\/edit-sessions$/
  );
  return match ? { setId: match[1] } : null;
}

function parseEditSessionAction(pathname: string): {
  setId: string;
  sessionId: string;
  action: "manual" | "marker" | "llm" | "undo" | "redo" | "finish" | "discard";
} | null {
  const match = pathname.match(
    /^\/api\/diagram-sets\/([a-z0-9][a-z0-9-]*)\/edit-sessions\/([a-z0-9][a-z0-9-]*)\/(manual|marker|llm|undo|redo|finish|discard)$/
  );
  return match ? {
    setId: match[1],
    sessionId: match[2],
    action: match[3] as "manual" | "marker" | "llm" | "undo" | "redo" | "finish" | "discard"
  } : null;
}

function parseExperimentArtifact(pathname: string): { catalogId: string } | null {
  const match = pathname.match(/^\/api\/experiments\/([a-z0-9][a-z0-9-]{0,127})\/artifact$/);
  return match ? { catalogId: match[1] } : null;
}

function parseDatasetItems(pathname: string): { datasetId: string } | null {
  const match = pathname.match(/^\/api\/diagram-datasets\/([a-z0-9][a-z0-9-]{0,127})\/items$/);
  return match ? { datasetId: match[1] } : null;
}

function parseDatasetItem(pathname: string): { datasetId: string; itemId: string } | null {
  const match = pathname.match(/^\/api\/diagram-datasets\/([a-z0-9][a-z0-9-]{0,127})\/items\/([a-z0-9][a-z0-9-]{0,127})$/);
  return match ? { datasetId: match[1], itemId: match[2] } : null;
}

export function diagramApi(
  projectRoot: string,
  diagramsDirectory = ".diagrams",
  experimentsRoot = `${projectRoot}/.datasets`,
  datasetCollectionsRoot = `${experimentsRoot}/diagram-collections`
): Plugin {
  const runtime = process.env.NEW_DIAGRAM_AGENT === "fake"
    ? new FakeDiagramAgentRuntime()
    : new PiDiagramAgentRuntime();
  const application = new DiagramApplication(
    new DiagramStore(projectRoot, diagramsDirectory),
    runtime
  );
  const experimentCatalog = new ExperimentCatalog(experimentsRoot);
  const datasetStore = new DiagramDatasetStore(datasetCollectionsRoot);
  let recovered: Promise<void> | undefined;
  const ensureRecovered = () => recovered ??= application.recoverInterruptedRuns();

  const middleware: Connect.NextHandleFunction = async (request, response, next) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/api/")) {
      next();
      return;
    }
    try {
      if (url.pathname === "/api/experiments") {
        if (request.method !== "GET") return sendJson(response, 405, { error: "method not allowed" });
        return sendJson(response, 200, await experimentCatalog.list());
      }
      if (url.pathname === "/api/diagram-datasets") {
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
        const source = body.source as Record<string, unknown> | undefined;
        if (!source) return sendJson(response, 400, { error: "diagram source is required" });
        const catalogId = typeof source.catalogId === "string" ? source.catalogId : "";
        const axisId = typeof source.axisId === "string" ? source.axisId : "";
        const iteration = Number(source.iteration);
        const value = Number(source.value);
        const replicate = Number(source.replicate);
        const catalog = await experimentCatalog.list();
        const experiment = catalog.experiments.find((candidate) => candidate.catalogId === catalogId);
        const axis = experiment?.axes.find((candidate) => candidate.id === axisId);
        const iterationSummary = axis?.iterations.find((candidate) => candidate.number === iteration);
        if (!experiment || !axis || !iterationSummary) throw new Error("experiment source was not found");
        const artifact = await experimentCatalog.artifact({ catalogId, axisId, iteration, value, replicate });
        return sendJson(response, 200, await datasetStore.addItem(datasetItems.datasetId, {
          name: artifact.name,
          labels: body.labels,
          source: {
            catalogId,
            experimentId: experiment.id,
            projectId: experiment.project.id,
            projectName: experiment.project.name,
            axisId,
            axisLabel: axis.label,
            iteration,
            value,
            replicate
          },
          metrics: artifact.metrics,
          ascii: artifact.artifact.ascii,
          codeEntityIds: artifact.artifact.codeEntityIds,
          modelId: artifact.modelId,
          promptConfigId: artifact.promptConfigId,
          testedPrompt: iterationSummary.aggregate?.prompt ?? ""
        }));
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
      await ensureRecovered();
      if (url.pathname === "/api/workspace") {
        if (request.method !== "GET") return sendJson(response, 405, { error: "method not allowed" });
        return sendJson(response, 200, await application.workspace());
      }
      if (url.pathname === "/api/artifact-bundle") {
        if (request.method !== "GET") return sendJson(response, 405, { error: "method not allowed" });
        const setId = url.searchParams.get("setId") ?? "";
        const artifactId = url.searchParams.get("artifactId") ?? "";
        const artifactKind = url.searchParams.get("artifactKind");
        if (artifactKind !== "diagram" && artifactKind !== "diagram-component") {
          return sendJson(response, 400, { error: "artifactKind must be diagram or diagram-component" });
        }
        return sendJson(
          response,
          200,
          await application.mappedArtifactBundle(setId, artifactKind, artifactId)
        );
      }
      if (url.pathname === "/api/call-graph-focus") {
        if (request.method !== "POST") return sendJson(response, 405, { error: "method not allowed" });
        return sendJson(response, 200, await application.callGraphFocus(await readBody(request)));
      }
      if (url.pathname === "/api/source") {
        if (request.method !== "GET") return sendJson(response, 405, { error: "method not allowed" });
        const setId = url.searchParams.get("setId") ?? "";
        const entityId = url.searchParams.get("entityId") ?? "";
        const rangeIndex = Number(url.searchParams.get("range") ?? "0");
        return sendJson(response, 200, await application.sourceSnippet(setId, entityId, rangeIndex));
      }
      if (url.pathname === "/api/system-prompt-templates") {
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
      if (url.pathname === "/api/code-entity-prompt-templates") {
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
      if (url.pathname === "/api/diagram-sets") {
        if (request.method !== "POST") return sendJson(response, 405, { error: "method not allowed" });
        const body = await readBody(request) as Record<string, unknown>;
        const inputPath = typeof body.path === "string" ? body.path : "";
        const name = typeof body.name === "string" ? body.name : "";
        const prompt = typeof body.prompt === "string" ? body.prompt : "";
        const requestedPromptTemplateId = body.promptTemplateId;
        const requestedCodeEntityPromptTemplateId = body.codeEntityPromptTemplateId;
        if (!inputPath || !name.trim()) {
          return sendJson(response, 400, { error: "repository path and DiagramSet name are required" });
        }
        const promptTemplate = await application.resolveSystemPromptTemplate(
          requestedPromptTemplateId
        );
        const codeEntityPromptTemplate = await application.resolveCodeEntityPromptTemplate(
          requestedCodeEntityPromptTemplateId
        );
        response.statusCode = 200;
        response.setHeader("content-type", "application/x-ndjson; charset=utf-8");
        response.setHeader("cache-control", "no-cache, no-transform");
        response.flushHeaders();
        const diagramSet = await application.createDiagramSet({ path: inputPath, name, prompt });
        sendEvent(response, {
          type: "created",
          diagramSetId: diagramSet.id,
          projectRoot: diagramSet.sourceCheckoutRoot,
          promptTemplateId: promptTemplate.id,
          codeEntityPromptTemplateId: codeEntityPromptTemplate.id
        });
        await application.collectCodeEntities(
          diagramSet.id,
          { promptTemplateId: codeEntityPromptTemplate.id },
          (event) => sendEvent(response, event)
        );
        const workspace = await application.generateInitialDiagrams(
          diagramSet.id,
          { promptTemplateId: promptTemplate.id },
          (event) => sendEvent(response, event)
        );
        const completedSet = workspace.diagramSets.find((set) => set.id === diagramSet.id);
        const batchId = completedSet?.generationBatchIds.at(-1);
        const batch = batchId ? workspace.generationBatches[batchId] : undefined;
        const promptConfig = batch
          ? workspace.generationPromptConfigs[batch.promptConfigId]
          : undefined;
        const codeEntitySet = completedSet
          ? workspace.codeEntitySets[completedSet.codeEntitiesSetId]
          : undefined;
        const codeEntityPromptConfig = codeEntitySet?.promptConfigId
          ? workspace.codeEntityPromptConfigs[codeEntitySet.promptConfigId]
          : undefined;
        sendEvent(response, {
          type: "result",
          diagramSetId: diagramSet.id,
          promptTemplateId: promptConfig?.systemPrompt.profileId,
          promptTemplateVersion: promptConfig?.systemPrompt.profileVersion,
          generationPromptConfigId: promptConfig?.id,
          codeEntityPromptTemplateId: codeEntityPromptConfig?.template.profileId,
          codeEntityPromptTemplateVersion: codeEntityPromptConfig?.template.profileVersion,
          codeEntityPromptConfigId: codeEntityPromptConfig?.id,
          workspace
        });
        if (!response.destroyed && !response.writableEnded) response.end();
        return;
      }
      const repositoryFiles = parseRepositoryFiles(url.pathname);
      if (repositoryFiles) {
        if (request.method !== "GET") return sendJson(response, 405, { error: "method not allowed" });
        return sendJson(
          response,
          200,
          await application.listRepositoryDirectory(
            repositoryFiles.setId,
            url.searchParams.get("path") ?? ""
          )
        );
      }
      const diagramSet = parseDiagramSet(url.pathname);
      if (diagramSet) {
        if (request.method !== "DELETE") return sendJson(response, 405, { error: "method not allowed" });
        return sendJson(response, 200, await application.deleteDiagramSet(diagramSet.setId));
      }
      if (url.pathname === "/api/imports") {
        if (request.method !== "POST") return sendJson(response, 405, { error: "method not allowed" });
        const body = await readBody(request) as Record<string, unknown>;
        const artifactKind = body.artifactKind;
        const name = typeof body.name === "string" ? body.name : "";
        const ascii = typeof body.ascii === "string" ? body.ascii : "";
        if (!name.trim() || !ascii.trim()) {
          return sendJson(response, 400, { error: "artifact name and ASCII are required" });
        }
        if (artifactKind !== "diagram" && artifactKind !== "diagram-component") {
          return sendJson(response, 400, { error: "artifactKind must be diagram or diagram-component" });
        }
        return sendJson(response, 200, await application.importArtifact({
          artifactKind,
          name,
          ascii,
          ...(body.bundle && typeof body.bundle === "object"
            ? { bundle: body.bundle as ArtifactImportInput["bundle"] }
            : {})
        }));
      }
      const importedDiagram = parseImportedDiagram(url.pathname);
      if (importedDiagram) {
        if (importedDiagram.archive) {
          if (request.method !== "POST") return sendJson(response, 405, { error: "method not allowed" });
          return sendJson(
            response,
            200,
            await application.archiveImportedDiagram(importedDiagram.diagramId)
          );
        }
        if (request.method !== "PATCH") return sendJson(response, 405, { error: "method not allowed" });
        const body = await readBody(request) as Record<string, unknown>;
        return sendJson(
          response,
          200,
          await application.renameImportedDiagram(
            importedDiagram.diagramId,
            typeof body.name === "string" ? body.name : ""
          )
        );
      }
      const importedComponent = parseImportedDiagramComponent(url.pathname);
      if (importedComponent) {
        if (!importedComponent.archive || request.method !== "POST") {
          return sendJson(response, 405, { error: "method not allowed" });
        }
        return sendJson(
          response,
          200,
          await application.archiveImportedDiagramComponent(importedComponent.componentId)
        );
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
      const referenceSelections: GenerationReferenceSelection[] | undefined = Array.isArray(body.referenceSelections)
        ? body.referenceSelections.slice(0, 200).flatMap((value) => {
          if (!value || typeof value !== "object") return [];
          const selection = value as Record<string, unknown>;
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
        : undefined;
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
        derivation
      }, (event) => sendEvent(response, event));
      sendEvent(response, { type: "result", workspace });
      response.end();
    } catch (error) {
      const message = error instanceof Error ? error.message : "request failed";
      if (response.headersSent) {
        sendEvent(response, { type: "error", error: message });
        if (!response.destroyed && !response.writableEnded) response.end();
      } else {
        sendJson(response, 400, { error: message });
      }
    }
  };

  const attach = (server: {
    middlewares: { use(handler: Connect.NextHandleFunction): void };
    httpServer?: { once(event: "close", listener: () => void): void } | null;
  }) => {
    server.middlewares.use(middleware);
    server.httpServer?.once("close", () => application.dispose());
  };
  return {
    name: "new-diagram-api",
    configureServer: attach,
    configurePreviewServer: attach
  };
}
