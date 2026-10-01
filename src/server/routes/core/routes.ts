import type { ServerResponse } from "node:http";
import type { Connect } from "vite";
import type { CoreApplication } from "../../../../application/core/application";
import type { ProjectCatalogService } from '../../../../application/core/representations/projectCatalogService';
import type { ProjectSourceService } from '../../../../application/core/source/projectSource';
import { type SaveProjectedTreeInput } from "../../../../domain/core/representations/catalogCommands";
import { readBody, sendJson } from "../../http/http";

export function createCoreRoutes({ application, source, catalog }: {
  source: ProjectSourceService;
  catalog: ProjectCatalogService;
  application: CoreApplication;
}) {
  return async (request: Connect.IncomingMessage, response: ServerResponse, url: URL): Promise<void> => {
    if (url.pathname === '/api/core/project/files') {
      if (request.method !== 'GET') return sendJson(response, 405, { error: 'method not allowed' });
      return sendJson(response, 200, await source.files(url.searchParams.get('projectId'), url.searchParams.get('path') ?? '', url.searchParams.get('sourceId') ?? undefined));
    }
    if (url.pathname === '/api/core/project/definitions') {
      if (request.method !== 'POST') return sendJson(response, 405, { error: 'method not allowed' });
      source.ensureDefinitionsEnabled();
      const body = await readBody(request) as Parameters<ProjectSourceService['definitions']>[0];
      const controller = new AbortController();
      const abort = () => { if (!response.writableEnded) controller.abort(); };
      response.once('close', abort);
      try {
        const result = await source.definitions(body, controller.signal);
        if (!response.destroyed) return sendJson(response, 200, result);
      } finally { response.removeListener('close', abort); }
      return;
    }
    if (url.pathname === '/api/core/project/source') {
      if (request.method !== 'GET') return sendJson(response, 405, { error: 'method not allowed' });
      return sendJson(response, 200, await source.source(url.searchParams.get('projectId'), url.searchParams.get('path'), url.searchParams.get('sourceId') ?? undefined));
    }
    if (url.pathname === '/api/core/project/projections') {
      if (request.method !== 'POST') return sendJson(response, 405, { error: 'method not allowed' });
      return sendJson(response, 200, await catalog.saveProjection(await readBody(request) as SaveProjectedTreeInput));
    }
    if (url.pathname === "/api/core/project/corpus-compactions") {
      await catalog.requireProject();
      if (request.method === "GET") return sendJson(response, 200, await catalog.compactions());
      if (request.method !== "POST") return sendJson(response, 405, { error: "method not allowed" });
      const body = await readBody(request);
      return sendJson(response, 201, await application.upsertProjectFileCompaction(
        body as import("../../../../domain/core/representations/projectCatalog").ProjectFileCompactionInput
      ));
    }

    if (url.pathname === "/api/core/project/representations") {
      if (request.method !== "GET") return sendJson(response, 405, { error: "method not allowed" });
      return sendJson(response, 200, await application.projectRepresentations(url.searchParams.get('history') === 'current' ? 'current' : 'all'));
    }

    return sendJson(response, 404, { error: "API route not found" });
  };
}
