import { CodexLocalChatRuntime, FakeLocalChatRuntime } from "./mapping/localChatRuntime";
import type { Connect, Plugin } from "vite";
import type { BuiltInDomainProfileId } from "../src/core/domainProfile";
import { CoreApplication } from "./core/application";
import { isBuiltInDomainProfileId } from "./core/domainProfiles";
import { ProjectDiagramConflict } from "./core/projectCatalogStore";
import { createCoreRoutes } from "./core/routes";
import { DiagramStore } from "./core/store";
import { FakeMappingAgentRuntime, PiMappingAgentRuntime } from "./mapping/agentRuntime";
import { createMappingRoutes } from "./mapping/routes";
import { FakeDiagramAgentRuntime, PiDiagramAgentRuntime } from "./studio/agentRuntime";
import { StudioApplication } from "./studio/application";
import { DiagramDatasetStore } from "./studio/diagramDatasetStore";
import { ExperimentCatalog } from "./studio/experimentCatalog";
import { createStudioRoutes } from "./studio/routes";
import { sendEvent, sendJson } from "./core/http";

/** Composition root: feature handlers and runtimes meet only here. */
export function diagramApi(
  projectRoot: string,
  diagramsDirectory = ".diagrams",
  experimentsRoot = `${projectRoot}/.datasets`,
  datasetCollectionsRoot = `${experimentsRoot}/diagram-collections`,
  configuredDomainProfileId: BuiltInDomainProfileId | undefined = isBuiltInDomainProfileId(
    process.env.NEW_DIAGRAM_DOMAIN
  ) ? process.env.NEW_DIAGRAM_DOMAIN : undefined,
  mappingPocSourceRoot = projectRoot
): Plugin {
  const fake = process.env.NEW_DIAGRAM_AGENT === "fake";
  const studioRuntime = fake ? new FakeDiagramAgentRuntime() : new PiDiagramAgentRuntime();
  const chatRuntime = fake ? new FakeLocalChatRuntime() : new CodexLocalChatRuntime();
  const mappingRuntime = fake ? new FakeMappingAgentRuntime() : new PiMappingAgentRuntime();
  const store = new DiagramStore(projectRoot, diagramsDirectory);
  const core = new CoreApplication(store);
  const studio = new StudioApplication(store, studioRuntime, configuredDomainProfileId ?? "source-code");
  const routes = {
    core: createCoreRoutes({ application: core }),
    studio: createStudioRoutes({
      application: studio,
      experimentCatalog: new ExperimentCatalog(experimentsRoot),
      datasetStore: new DiagramDatasetStore(datasetCollectionsRoot),
      configuredDomainProfileId
    }),
    mapping: createMappingRoutes({
      application: core, runtime: mappingRuntime, chatRuntime, projectRoot,
      configuredDomainProfileId, mappingPocSourceRoot
    })
  };
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
      await (recovered ??= studio.recoverInterruptedRuns());
      await routes[namespace as keyof typeof routes](request, response, url);
    } catch (error) {
      const message = error instanceof Error ? error.message : "request failed";
      if (response.headersSent) {
        sendEvent(response, { type: "error", error: message });
        if (!response.destroyed && !response.writableEnded) response.end();
      } else {
        sendJson(response, error instanceof ProjectDiagramConflict ? 409 : 400, { error: message });
      }
    }
  };
  const attach = (server: {
    middlewares: { use(handler: Connect.NextHandleFunction): void };
    httpServer?: { once(event: "close", listener: () => void): void } | null;
  }) => {
    server.middlewares.use(middleware);
    server.httpServer?.once("close", () => {
      studio.dispose();
      mappingRuntime.dispose();
      chatRuntime.dispose();
    });
  };
  return { name: "new-diagram-api", configureServer: attach, configurePreviewServer: attach };
}
