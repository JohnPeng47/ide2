import type { ServerResponse } from "node:http";
import type { Connect, Plugin } from "vite";
import { FakeDiagramAgentRuntime, PiDiagramAgentRuntime } from "./agentRuntime";
import { DiagramApplication } from "./application";
import { DiagramStore } from "./store";

const MAX_REQUEST_BYTES = 256 * 1024;

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

function parseProjectImport(pathname: string): { projectId: string } | null {
  const match = pathname.match(/^\/api\/projects\/([a-z0-9][a-z0-9-]*)\/imports$/);
  return match ? { projectId: match[1] } : null;
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

export function diagramApi(projectRoot: string, diagramsDirectory = ".diagrams"): Plugin {
  const runtime = process.env.NEW_DIAGRAM_AGENT === "fake"
    ? new FakeDiagramAgentRuntime()
    : new PiDiagramAgentRuntime();
  const application = new DiagramApplication(
    new DiagramStore(projectRoot, diagramsDirectory),
    runtime
  );
  let recovered: Promise<void> | undefined;
  const ensureRecovered = () => recovered ??= application.recoverInterruptedRuns();

  const middleware: Connect.NextHandleFunction = async (request, response, next) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/api/")) {
      next();
      return;
    }
    try {
      await ensureRecovered();
      if (url.pathname === "/api/workspace") {
        if (request.method !== "GET") return sendJson(response, 405, { error: "method not allowed" });
        return sendJson(response, 200, await application.workspace());
      }
      if (url.pathname === "/api/source") {
        if (request.method !== "GET") return sendJson(response, 405, { error: "method not allowed" });
        const setId = url.searchParams.get("setId") ?? "";
        const entityId = url.searchParams.get("entityId") ?? "";
        const rangeIndex = Number(url.searchParams.get("range") ?? "0");
        return sendJson(response, 200, await application.sourceSnippet(setId, entityId, rangeIndex));
      }
      if (url.pathname === "/api/diagram-sets") {
        if (request.method !== "POST") return sendJson(response, 405, { error: "method not allowed" });
        const body = await readBody(request) as Record<string, unknown>;
        const inputPath = typeof body.path === "string" ? body.path : "";
        const name = typeof body.name === "string" ? body.name : "";
        const prompt = typeof body.prompt === "string" ? body.prompt : "";
        if (!inputPath || !name.trim()) {
          return sendJson(response, 400, { error: "repository path and DiagramSet name are required" });
        }
        response.statusCode = 200;
        response.setHeader("content-type", "application/x-ndjson; charset=utf-8");
        response.setHeader("cache-control", "no-cache, no-transform");
        response.flushHeaders();
        const diagramSet = await application.createDiagramSet({ path: inputPath, name, prompt });
        sendEvent(response, {
          type: "created",
          diagramSetId: diagramSet.id,
          projectRoot: diagramSet.sourceCheckoutRoot
        });
        await application.collectCodeEntities(diagramSet.id, (event) => sendEvent(response, event));
        const workspace = await application.generateInitialDiagrams(
          diagramSet.id,
          (event) => sendEvent(response, event)
        );
        sendEvent(response, {
          type: "result",
          diagramSetId: diagramSet.id,
          workspace
        });
        if (!response.destroyed && !response.writableEnded) response.end();
        return;
      }
      const projectImport = parseProjectImport(url.pathname);
      if (projectImport) {
        if (request.method !== "POST") return sendJson(response, 405, { error: "method not allowed" });
        const body = await readBody(request) as Record<string, unknown>;
        const diagramSetId = typeof body.diagramSetId === "string" ? body.diagramSetId : "";
        const artifactKind = body.artifactKind;
        const name = typeof body.name === "string" ? body.name : "";
        const ascii = typeof body.ascii === "string" ? body.ascii : "";
        const codeEntityIds = Array.isArray(body.codeEntityIds)
          ? body.codeEntityIds.filter((value): value is string => typeof value === "string")
          : undefined;
        if (!diagramSetId || !name.trim() || !ascii.trim()) {
          return sendJson(response, 400, { error: "DiagramSet, artifact name, and ASCII are required" });
        }
        if (artifactKind !== "diagram" && artifactKind !== "diagram-component") {
          return sendJson(response, 400, { error: "artifactKind must be diagram or diagram-component" });
        }
        return sendJson(response, 200, await application.importArtifact(projectImport.projectId, {
          diagramSetId,
          artifactKind,
          name,
          ascii,
          codeEntityIds
        }));
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
      const modelId = typeof body.modelId === "string" ? body.modelId : undefined;
      const promptProfileId = typeof body.promptProfileId === "string"
        ? body.promptProfileId
        : undefined;
      if (outputKind !== "diagram" && outputKind !== "diagram-component") {
        return sendJson(response, 400, { error: "outputKind must be diagram or diagram-component" });
      }
      response.statusCode = 200;
      response.setHeader("content-type", "application/x-ndjson; charset=utf-8");
      response.setHeader("cache-control", "no-cache, no-transform");
      response.flushHeaders();
      const workspace = await application.generate(generation.setId, {
        prompt,
        selectedCodeEntityIds,
        count,
        outputKind,
        modelId,
        promptProfileId
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
