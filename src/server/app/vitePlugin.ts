import type { Connect, Plugin } from "vite";
import { ApplicationError } from '../../../application/core/errors';
import type { BuiltInDomainProfileId } from "../../../domain/core/profiles/domainProfile";
import { isBuiltInDomainProfileId } from "../../../domain/core/profiles/domainProfiles";
import { ProjectDiagramConflict } from "../../../domain/core/representations/errors";
import { createBackend } from './bootstrap';

import { sendEvent, sendJson } from "../http/http";

/** Vite adapter: mount HTTP routes and translate transport errors. */
export function diagramApi(
  projectRoot: string,
  diagramsDirectory = ".diagrams",
  experimentsRoot = `${projectRoot}/.datasets`,
  datasetCollectionsRoot = `${experimentsRoot}/diagram-collections`,
  configuredDomainProfileId: BuiltInDomainProfileId | undefined = isBuiltInDomainProfileId(
    process.env.NEW_DIAGRAM_DOMAIN
  ) ? process.env.NEW_DIAGRAM_DOMAIN : undefined,
  mappingPocSourceRoot = projectRoot,
  options: { lspEnabled?: boolean } = {}
): Plugin {
  const backend = createBackend(projectRoot, diagramsDirectory, experimentsRoot, datasetCollectionsRoot,
    configuredDomainProfileId, mappingPocSourceRoot, options);
  const { routes } = backend;
  let recovered: Promise<void> | undefined;
  const middleware: Connect.NextHandleFunction = async (request, response, next) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/api/") && !url.pathname.startsWith("/internal/mapping/")) {
      next();
      return;
    }
    const namespace = url.pathname.split("/")[2];
    if (!url.pathname.startsWith("/api/") || !Object.hasOwn(routes, namespace)) {
      return sendJson(response, 404, { error: "API route not found" });
    }
    try {
      await (recovered ??= backend.recover());
      await routes[namespace as keyof typeof routes](request, response, url);
    } catch (error) {
      const message = error instanceof Error ? error.message : "request failed";
      if (response.headersSent) {
        sendEvent(response, { type: "error", error: message });
        if (!response.destroyed && !response.writableEnded) response.end();
      } else {
        const status = error instanceof ProjectDiagramConflict ? 409 : error instanceof ApplicationError
          ? { conflict: 409, 'invalid-input': 400, 'binary-source': 415, 'lsp-disabled': 503 }[error.code] : 400;
        sendJson(response, status, { ...(error instanceof ApplicationError && error.code === 'lsp-disabled' ? { code: 'LSP_DISABLED' } : {}), error: message });
      }
    }
  };
  const attach = (server: {
    middlewares: { use(handler: Connect.NextHandleFunction): void };
    httpServer?: { once(event: "close", listener: () => void): void } | null;
  }) => {
    server.middlewares.use(middleware);
    server.httpServer?.once("close", () => {
      backend.dispose();
    });
  };
  return { name: "new-diagram-api", configureServer: attach, configurePreviewServer: attach };
}
