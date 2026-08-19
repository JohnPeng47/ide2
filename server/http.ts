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

function parseSetAction(pathname: string): { setId: string; action: string } | null {
  const match = pathname.match(/^\/api\/diagram-sets\/([a-z0-9][a-z0-9-]*)\/(finalize|generate)$/);
  return match ? { setId: match[1], action: match[2] } : null;
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

export function diagramApi(projectRoot: string): Plugin {
  const runtime = process.env.NEW_DIAGRAM_AGENT === "fake"
    ? new FakeDiagramAgentRuntime()
    : new PiDiagramAgentRuntime();
  const application = new DiagramApplication(new DiagramStore(projectRoot), runtime);
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
        sendEvent(response, {
          type: "result",
          diagramSetId: diagramSet.id,
          workspace: await application.workspace()
        });
        if (!response.destroyed && !response.writableEnded) response.end();
        return;
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
      const action = parseSetAction(url.pathname);
      if (!action) return sendJson(response, 404, { error: "API route not found" });
      if (request.method !== "POST") return sendJson(response, 405, { error: "method not allowed" });
      const body = await readBody(request) as Record<string, unknown>;
      if (action.action === "finalize") {
        return sendJson(response, 200, await application.finalizeCodeEntities(action.setId));
      }
      const count = Number(body.count);
      const prompt = typeof body.prompt === "string" ? body.prompt : "";
      const selectedCodeEntityIds = Array.isArray(body.selectedCodeEntityIds)
        ? body.selectedCodeEntityIds.filter((value): value is string => typeof value === "string")
        : [];
      response.statusCode = 200;
      response.setHeader("content-type", "application/x-ndjson; charset=utf-8");
      response.setHeader("cache-control", "no-cache, no-transform");
      response.flushHeaders();
      const workspace = await application.generate(action.setId, {
        prompt,
        selectedCodeEntityIds,
        count
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
