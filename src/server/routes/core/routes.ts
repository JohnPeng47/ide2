import type { ServerResponse } from "node:http";
import type { Connect } from "vite";
import type { CoreApplication } from "../../../../application/core/application";
import type { PlanService } from '../../../../application/core/plans/planService';
import type { ProjectCatalogService } from '../../../../application/core/representations/projectCatalogService';
import type { ProjectSourceService } from '../../../../application/core/source/projectSource';
import { type ArtifactImportInput } from "../../../../domain/core/records/domain";
import { type SaveProjectedTreeInput } from "../../../../domain/core/representations/catalogCommands";
import { readBody, sendJson } from "../../http/http";

function parseRepositoryFiles(pathname: string): { setId: string } | null {
  const match = pathname.match(/^\/api\/core\/diagram-sets\/([a-z0-9][a-z0-9-]*)\/files$/);
  return match ? { setId: match[1] } : null;
}

function parseHighlight(pathname: string): { highlightId: string } | null {
  const match = pathname.match(/^\/api\/core\/highlights\/([a-z0-9][a-z0-9-]*)$/);
  return match ? { highlightId: match[1] } : null;
}

function parsePlan(pathname: string): { planId: string } | null {
  const match = pathname.match(/^\/api\/core\/plans\/([a-z0-9][a-z0-9-]*)$/);
  return match ? { planId: match[1] } : null;
}

function parseImportedDiagram(pathname: string): { diagramId: string; archive: boolean } | null {
  const match = pathname.match(/^\/api\/core\/imports\/diagrams\/([a-z0-9][a-z0-9-]*)(\/archive)?$/);
  return match ? { diagramId: match[1], archive: Boolean(match[2]) } : null;
}

function parseImportedDiagramComponent(
  pathname: string
): { componentId: string; archive: boolean } | null {
  const match = pathname.match(
    /^\/api\/core\/imports\/diagram-components\/([a-z0-9][a-z0-9-]*)(\/archive)?$/
  );
  return match ? { componentId: match[1], archive: Boolean(match[2]) } : null;
}
export function createCoreRoutes({ application, source, plans, catalog }: {
  source: ProjectSourceService;
  plans: PlanService;
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
    if (url.pathname === '/api/core/plans') {
      if (request.method === 'GET') return sendJson(response, 200, await plans.list());
      if (request.method !== 'POST') return sendJson(response, 405, { error: 'method not allowed' });
      return sendJson(response, 201, await plans.create(await readBody(request) as Record<string, unknown>));
    }
    const planRoute = parsePlan(url.pathname);
    if (planRoute) {
      if (request.method === 'GET') return sendJson(response, 200, await plans.get(planRoute.planId));
      if (request.method !== 'PATCH') return sendJson(response, 405, { error: 'method not allowed' });
      return sendJson(response, 200, await plans.update(planRoute.planId, await readBody(request) as Record<string, unknown>));
    }

    if (url.pathname === "/api/core/workspace") {
      if (request.method !== "GET") return sendJson(response, 405, { error: "method not allowed" });
      return sendJson(response, 200, await application.workspace());
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
      return sendJson(response, 200, await application.projectRepresentations());
    }

    if (url.pathname === "/api/core/highlights") {
      if (request.method !== "POST") return sendJson(response, 405, { error: "method not allowed" });
      const body = await readBody(request) as Record<string, unknown>;
      return sendJson(response, 201, await application.addHighlight({
        diagramSetId: body.diagramSetId,
        artifactKind: body.artifactKind,
        artifactId: body.artifactId,
        mappingId: body.mappingId
      }));
    }

    const highlight = parseHighlight(url.pathname);

    if (highlight) {
      if (request.method !== "DELETE") return sendJson(response, 405, { error: "method not allowed" });
      return sendJson(response, 200, await application.deleteHighlight(highlight.highlightId));
    }

    if (url.pathname === "/api/core/artifact-bundle") {
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

    if (url.pathname === "/api/core/call-graph-focus") {
      if (request.method !== "POST") return sendJson(response, 405, { error: "method not allowed" });
      return sendJson(response, 200, await application.callGraphFocus(await readBody(request)));
    }

    if (url.pathname === "/api/core/source") {
      if (request.method !== "GET") return sendJson(response, 405, { error: "method not allowed" });
      const setId = url.searchParams.get("setId") ?? "";
      const entityId = url.searchParams.get("entityId") ?? "";
      const rangeIndex = Number(url.searchParams.get("range") ?? "0");
      return sendJson(response, 200, await application.sourceSnippet(setId, entityId, rangeIndex));
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

    if (url.pathname === "/api/core/imports") {
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
    return sendJson(response, 404, { error: "API route not found" });
  };
}
