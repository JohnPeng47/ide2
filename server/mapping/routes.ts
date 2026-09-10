import { handleLocalChat } from "./localChatRoutes";
import type { LocalChatRuntime } from "./localChatRuntime";
import type { ServerResponse } from "node:http";
import type { Connect } from "vite";
import type { DiagramElementMapping } from "../../src/core/domain";
import type { BuiltInDomainProfileId } from "../../src/core/domainProfile";
import type { SaveProjectDiagramInput } from "../../src/core/projectDiagramCanvas";
import { validateMappingPocMappings } from "../../src/mapping/mappingPocPrompt";
import type { CoreApplication } from "../core/application";
import { ProjectDiagramConflict } from "../core/projectCatalogStore";
import { discoverDomainCorpus } from "../core/store";
import { readBody, sendEvent, sendJson } from "../core/http";
import type { MappingAgentRuntime } from "./agentRuntime";

export function createMappingRoutes({ application, runtime, chatRuntime, projectRoot, configuredDomainProfileId, mappingPocSourceRoot }: {
  application: CoreApplication;
  chatRuntime: LocalChatRuntime;
  runtime: MappingAgentRuntime; projectRoot: string; configuredDomainProfileId?: BuiltInDomainProfileId; mappingPocSourceRoot: string;
}) {
  return async (request: Connect.IncomingMessage, response: ServerResponse, url: URL): Promise<void> => {

    if (url.pathname === "/api/mapping/chat") return handleLocalChat(request, response, { application, chatRuntime, mappingPocSourceRoot });

    if (url.pathname === "/api/mapping/diagrams") {
      if (request.method !== "POST") return sendJson(response, 405, { error: "method not allowed" });
      const input = await readBody(request) as SaveProjectDiagramInput;
      const project = await application.store.loadProject()
        ?? await application.store.ensureProject(await discoverDomainCorpus(projectRoot, configuredDomainProfileId ?? "source-code"));
      const result = await application.store.projectCatalogs.saveMappingDiagram(project.id, input);
      return sendJson(response, 200, { project, ...result });
    }

    if (url.pathname === "/api/mapping/prompt") {
      if (request.method !== "POST") return sendJson(response, 405, { error: "method not allowed" });
      const body = await readBody(request) as Record<string, unknown>;
      const clientSessionId = typeof body.clientSessionId === "string" ? body.clientSessionId : "";
      const diagramAscii = typeof body.diagramAscii === "string" ? body.diagramAscii : "";
      const diagramRevision = Number(body.diagramRevision);
      const instruction = typeof body.instruction === "string" ? body.instruction : "";
      const rawSelection = body.selection as Record<string, unknown> | undefined;
      if (!/^[A-Za-z0-9-]{8,120}$/.test(clientSessionId)) {
        return sendJson(response, 400, { error: "valid clientSessionId is required" });
      }
      if (!diagramAscii || diagramAscii.length > 20000) {
        return sendJson(response, 400, { error: "diagramAscii must contain at most 20000 characters" });
      }
      if (!Number.isInteger(diagramRevision) || diagramRevision < 0) {
        return sendJson(response, 400, { error: "diagramRevision must be a non-negative integer" });
      }
      if (!instruction.trim() || instruction.length > 4000) {
        return sendJson(response, 400, { error: "instruction must contain at most 4000 characters" });
      }
      if (!rawSelection) return sendJson(response, 400, { error: "selection is required" });
      const selection = {
        startLine: Number(rawSelection.startLine),
        endLine: Number(rawSelection.endLine),
        startColumn: Number(rawSelection.startColumn),
        endColumn: Number(rawSelection.endColumn)
      };
      if (!Object.values(selection).every((value) => Number.isInteger(value) && value >= 1)) {
        return sendJson(response, 400, { error: "selection coordinates must be positive integers" });
      }
      if (body.operation !== undefined && body.operation !== "edit" && body.operation !== "generate") {
        return sendJson(response, 400, { error: "operation must be edit or generate" });
      }
      let mappings: DiagramElementMapping[] | undefined;
      if (body.mappings !== undefined) {
        try {
          if (!Array.isArray(body.mappings)) throw new Error("mappings must be an array");
          mappings = body.mappings as DiagramElementMapping[];
          validateMappingPocMappings(diagramAscii, mappings);
        } catch (error) {
          return sendJson(response, 400, { error: error instanceof Error ? error.message : "invalid mappings" });
        }
      }
      let projectEvidence: Record<string, import("../../src/core/projectCatalog").ProjectRepresentationEvidenceRecord> | undefined;
      let sourceRoot = mappingPocSourceRoot;
      if (body.representationId !== undefined || body.projectId !== undefined || body.baseRevisionId !== undefined) {
        const project = await application.store.loadProject();
        if (!project || body.projectId !== project.id) throw new Error("Diagram belongs to another Project");
        const catalog = await application.store.projectCatalogs.loadRepresentationCatalog(project.id);
        const representation = catalog.representations[String(body.representationId)];
        if (!representation || representation.status === "archived"
          || representation.currentRevisionId !== body.baseRevisionId) throw new ProjectDiagramConflict("Diagram revision has changed; reopen it before prompting");
        projectEvidence = catalog.revisions[representation.currentRevisionId].evidence;
        sourceRoot = project.corpus.root;
        if (!mappings) throw new Error("Project diagram mappings are required");
      }
      response.statusCode = 200;
      response.setHeader("content-type", "application/x-ndjson; charset=utf-8");
      response.setHeader("cache-control", "no-cache, no-transform");
      response.flushHeaders();
      const result = await runtime.promptDiagramSelection({
        operation: body.operation as "edit" | "generate" | undefined,
        mappings,
        clientSessionId,
        diagramAscii,
        diagramRevision,
        selection,
        instruction,
        sourceRoot,
        projectEvidence
      }, (event) => sendEvent(response, { type: "progress", ...event }));
      sendEvent(response, { type: "result", result });
      response.end();
      return;
    }
    return sendJson(response, 404, { error: "API route not found" });
  };
}
