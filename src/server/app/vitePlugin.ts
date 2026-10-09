import { isAgentMutationRequest } from '../http/apiAccess';
import { attachLiveCanvasSockets } from '../routes/mapping/liveCanvasRoutes';
import type { Connect, Plugin, ViteDevServer, PreviewServer } from "vite";
import { ApplicationError } from '../../../application/core/errors';
import type { BuiltInDomainProfileId } from "../../../domain/core/profiles/domainProfile";
import { isBuiltInDomainProfileId } from "../../../domain/core/profiles/domainProfiles";
import { ProjectDiagramConflict } from "../../../domain/core/representations/errors";
import { createBackend } from './bootstrap';

import { RequestTooLarge, sendEvent, sendJson } from "../http/http";

/** Vite adapter: mount HTTP routes and translate transport errors. */
export function diagramApi(
  projectRoot: string,
  diagramsDirectory = ".diagrams",
  configuredDomainProfileId: BuiltInDomainProfileId | undefined = isBuiltInDomainProfileId(
    process.env.NEW_DIAGRAM_DOMAIN
  ) ? process.env.NEW_DIAGRAM_DOMAIN : undefined,
  mappingPocSourceRoot = projectRoot,
  options: { httpEnabled?: boolean; piEnabled?: boolean; lspEnabled?: boolean } = {}
): Plugin {
  const backend = createBackend(projectRoot, diagramsDirectory,
    configuredDomainProfileId, mappingPocSourceRoot, options);
  const middleware: Connect.NextHandleFunction = async (request, response, next) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (!["/api", "/internal"].some(prefix => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))) {
      next();
      return;
    }
    if (options.httpEnabled !== true && isAgentMutationRequest(request.method, url.pathname)) return sendJson(response, 403, {
      code: "HTTP_WRITES_DISABLED", error: "Agent API writes are disabled; start the server with --http to enable them."
    });
    const { routes } = backend;
    const namespace = url.pathname.split("/")[2];
    if (!url.pathname.startsWith("/api/") || !Object.hasOwn(routes, namespace)) {
      return sendJson(response, 404, { error: "API route not found" });
    }
    try {
      await routes[namespace as keyof typeof routes](request, response, url);
    } catch (error) {
      const message = error instanceof Error ? error.message : "request failed";
      if (response.headersSent) {
        sendEvent(response, { type: "error", error: message });
        if (!response.destroyed && !response.writableEnded) response.end();
      } else {
        const status = error instanceof RequestTooLarge ? 413 : error instanceof ProjectDiagramConflict ? 409 : error instanceof ApplicationError
          ? { conflict: 409, 'invalid-input': 400, 'binary-source': 415, 'lsp-disabled': 503, 'ai-disabled': 503, 'storage-unavailable': 503 }[error.code] : 400;
        sendJson(response, status, { ...(error instanceof ApplicationError && ['lsp-disabled', 'ai-disabled'].includes(error.code) ? { code: error.code === 'ai-disabled' ? 'AI_DISABLED' : 'LSP_DISABLED' } : {}), error: message });
      }
    }
  };
  const attach = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use(middleware);
    const disposeSockets = server.httpServer
      ? attachLiveCanvasSockets(server.httpServer, backend.liveCanvas, { agentContextUploadsEnabled: options.httpEnabled === true }) : undefined;
    server.httpServer?.once("close", () => {
      disposeSockets?.();
      backend.dispose();
    });
  };
  return { name: "new-diagram-api", configureServer: attach, configurePreviewServer: attach };
}
