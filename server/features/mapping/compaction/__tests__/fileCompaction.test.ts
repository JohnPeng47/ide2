import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { tmpdir } from "node:os";
import type { Connect } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileCompactionDraft, FileCompactionEvent } from "../../../../../domain/mapping/compaction/fileCompaction";
import { diagramApi } from "../../../../app/vitePlugin";
import { CoreApplication } from "../../../../core/application";
import { DiagramStore } from "../../../../core/persistence/store";
import { runAgentWorkflow } from "../../../../infrastructure/agents/agentWorkflow";
import { FakeFileCompactionRuntime, type FileCompactionRuntime, type FileCompactionContext, type FileCompactionSession } from "../fileCompactionRuntime";
import { FileCompactionService } from "../fileCompactionService";
import { FileCompactionStore } from "../fileCompactionStore";
import { compactionSnapshot, createFileCompactionWorkflow, loadFileCompactionPrompts, sha256, validateFileCompactionDraft } from "../fileCompactionWorkflow";

const roots: string[] = [];
const servers: Server[] = [];
const services: FileCompactionService[] = [];
afterEach(async () => {
  services.splice(0).forEach((service) => service.dispose());
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections(); server.close(() => resolve());
  })));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  vi.unstubAllEnvs();
});

const sourceText = "export function example() {\r\n  return 1;\r\n}\r\n";
const source = { sourceFile: "source.ts", text: sourceText, lineCount: 3, sourceSha256: sha256(sourceText) };
const valid = (): FileCompactionDraft => ({ ascii: "source.ts\n|\n\\-- return 1", mappings: [
  { treeLine: 1, sourceRanges: [{ startLine: 1, endLine: 3 }] },
  { treeLine: 3, sourceRanges: [{ startLine: 2, endLine: 2 }] }
] });

function runtimeWithStep(execute: (
  request: Parameters<FileCompactionSession["runStep"]>[0], context: FileCompactionContext, session: FileCompactionSession
) => ReturnType<FileCompactionSession["runStep"]>): FileCompactionRuntime {
  return {
    dispose() {},
    async openSession(context) {
      const session = await new FakeFileCompactionRuntime().openSession(context);
      return { runStep: (request) => execute(request, context, session), dispose: () => session.dispose() };
    }
  };
}

async function fixture(runtime: FileCompactionRuntime = new FakeFileCompactionRuntime()) {
  const root = await mkdtemp(path.join(tmpdir(), "file-compaction-")); roots.push(root);
  await mkdir(path.join(root, ".git"));
  await writeFile(path.join(root, source.sourceFile), sourceText);
  const store = new DiagramStore(root);
  const project = await store.ensureProject({ checkoutRoot: root, repositoryIdentity: path.join(root, ".git") });
  const application = new CoreApplication(store);
  const service = new FileCompactionService(application, runtime); services.push(service);
  const input = { projectId: project.id, sourceFile: source.sourceFile };
  return { root, store, project, application, service, input };
}

async function run(service: FileCompactionService, input: unknown, signal?: AbortSignal) {
  const events: FileCompactionEvent[] = [];
  await service.run(await service.prepare(input), { signal, onEvent: (event) => { events.push(event); } });
  const started = events.find((event) => event.type === "started")!;
  return { events, saved: (await service.get(started.runId))! };
}

describe("file compaction workflow", () => {
  it("loads the renamed prompts and sends refinement as a follow-up without repeating source", async () => {
    const prompts = await loadFileCompactionPrompts();
    expect(prompts.compact.text).toBe(await readFile(new URL("../prompts/compaction/single-file-compact.md", import.meta.url), "utf8"));
    expect(prompts.refine.text).toBe(await readFile(new URL("../prompts/compaction/single-file-compact2.md", import.meta.url), "utf8"));
    expect(prompts.compact.sha256).toBe(sha256(prompts.compact.text));
    const workflow = createFileCompactionWorkflow(source, prompts);
    const executed: string[] = [];
    await runAgentWorkflow(workflow, async ({ stepId, prompt }) => {
      executed.push(stepId);
      if (stepId === "compact") {
        const context = JSON.parse(prompt.slice(prompt.lastIndexOf("\n\n") + 2));
        expect(context.source).toBe(sourceText);
        expect(context.firstPass).toBeUndefined();
      } else {
        expect(prompt).toBe(prompts.refine.text);
        expect(prompt).not.toContain(sourceText);
      }
      return valid();
    });
    expect(executed).toEqual(["compact", "refine"]);
  });

  it.each(["missing", "duplicate", "bounds", "connector", "unicode", "root"])("rejects %s mappings or output", (kind) => {
    const draft = valid();
    if (kind === "missing") draft.mappings.pop();
    if (kind === "duplicate") draft.mappings.push(draft.mappings[0]);
    if (kind === "bounds") draft.mappings[1].sourceRanges[0].endLine = 4;
    if (kind === "connector") draft.mappings[1].treeLine = 2;
    if (kind === "unicode") draft.ascii += "é";
    if (kind === "root") draft.mappings[0].sourceRanges[0].endLine = 2;
    expect(() => validateFileCompactionDraft(draft, source)).toThrow();
  });

  it("creates a snapshot with server-computed hashes", () => {
    const snapshot = compactionSnapshot(valid(), source);
    expect(snapshot.sourceSha256).toBe(sha256(Buffer.from(sourceText)));
    expect(snapshot.asciiSha256).toBe(sha256(valid().ascii));
  });
});

describe("file compaction service", () => {
  it.each(["completed", "failed", "cancelled"])("opens one session and closes it when the run is %s", async (status) => {
    const controller = new AbortController();
    const close = vi.fn();
    const openSession = vi.fn(async (context: FileCompactionContext): Promise<FileCompactionSession> => {
      const session = await new FakeFileCompactionRuntime().openSession(context);
      return {
        async runStep(request, progress) {
          if (request.stepId === "refine") {
            if (status === "failed") throw new Error("refinement failed");
            if (status === "cancelled") controller.abort(new Error("cancelled"));
          }
          return session.runStep(request, progress);
        },
        dispose() { close(); session.dispose(); }
      };
    });
    const { service, input } = await fixture({ openSession, dispose() {} });
    const { saved } = await run(service, input, controller.signal);
    expect(saved.status).toBe(status);
    expect(openSession).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("saves both passes, prompts and exact source bytes under the configured store", async () => {
    const { service, input, root, store } = await fixture();
    const { events, saved } = await run(service, input);
    expect(saved.status).toBe("completed");
    expect(saved.result?.sourceStale).toBe(false);
    expect(saved.steps.compact?.model).toBe("fake/test");
    expect(saved.steps.refine?.prompt).toBe(saved.prompts.refine.text);
    expect(events.at(-1)?.type).toBe("result");
    const base = path.join(store.storeRoot, "mapping/compactions", saved.id);
    expect(await readFile(path.join(base, "source.txt"))).toEqual(Buffer.from(sourceText));
    for (const stage of ["compact", "refine"] as const) {
      const files = saved.result!.artifacts[stage];
      expect(await readFile(path.join(store.storeRoot, files.text), "utf8")).toBe(saved.steps[stage]!.snapshot!.ascii);
      const mappings = JSON.parse(await readFile(path.join(store.storeRoot, files.mappings), "utf8"));
      expect(mappings.sourceSha256).toBe(source.sourceSha256);
      expect(mappings.treeFile).toBe(`${stage}.txt`);
    }
    expect(await readFile(path.join(root, source.sourceFile), "utf8")).toBe(sourceText);
    const reopened = new FileCompactionService(new CoreApplication(store), new FakeFileCompactionRuntime());
    expect((await reopened.get(saved.id))?.result).toEqual(saved.result);
    reopened.dispose();
  });

  it("retains the draft when refinement fails and emits no successful result", async () => {
    const { service, input } = await fixture(runtimeWithStep(async (request, context, session) => {
      if (request.stepId === "refine") throw new Error("refinement failed");
      return session.runStep(request, () => {});
    }));
    const { events, saved } = await run(service, input);
    expect(saved.status).toBe("failed");
    expect(saved.steps.compact?.snapshot).toBeDefined();
    expect(saved.steps.refine?.snapshot).toBeUndefined();
    expect(saved.result).toBeUndefined();
    expect(events.at(-1)).toMatchObject({ type: "error", stage: "refine", error: "refinement failed" });
  });

  it("does not start refinement when the first pass is invalid", async () => {
    const execute = vi.fn(async () => ({ model: "test", draft: { ascii: "invalid", mappings: [] } }));
    const { service, input } = await fixture(runtimeWithStep(execute));
    const { saved } = await run(service, input);
    expect(saved.status).toBe("failed");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(saved.steps.compact?.snapshot).toBeUndefined();
  });

  it("flags source edits while keeping both stages pinned to the original snapshot", async () => {
    const { service, input } = await fixture(runtimeWithStep(async (request, context, session) => {
      expect(context.source.text).toBe(sourceText);
      if (request.stepId === "compact") await writeFile(path.join(context.sourceRoot, source.sourceFile), "changed\n");
      return session.runStep(request, () => {});
    }));
    const { saved } = await run(service, input);
    expect(saved.result).toMatchObject({ sourceStale: true, snapshot: { sourceSha256: source.sourceSha256 } });
  });

  it("cancels refinement and retains the accepted first pass", async () => {
    const controller = new AbortController();
    const { service, input } = await fixture(runtimeWithStep(async (request, context, session) => {
      if (request.stepId === "refine") controller.abort(new Error("cancelled by client"));
      return session.runStep(request, () => {});
    }));
    const { saved } = await run(service, input, controller.signal);
    expect(saved.status).toBe("cancelled");
    expect(saved.steps.compact?.snapshot).toBeDefined();
    expect(saved.result).toBeUndefined();
  });

  it("reports unfinished persisted runs as interrupted after restart", async () => {
    const { service, input, store } = await fixture();
    const { saved } = await run(service, input);
    await new FileCompactionStore(store.storeRoot).save({ ...saved, status: "running", result: undefined });
    expect((await service.get(saved.id))?.status).toBe("interrupted");
  });

  it("rejects foreign projects, unsafe paths, symlinks, invalid UTF-8, and empty files", async () => {
    const { service, input, root } = await fixture();
    await expect(service.prepare({ ...input, projectId: "other" })).rejects.toThrow("another Project");
    await symlink(path.join(root, source.sourceFile), path.join(root, "link.ts"));
    for (const sourceFile of ["../source.ts", path.join(root, "source.ts"), "link.ts", "missing.ts"]) {
      await expect(service.prepare({ ...input, sourceFile })).rejects.toThrow();
    }
    await writeFile(path.join(root, source.sourceFile), Buffer.from([0xff]));
    await expect(service.prepare(input)).rejects.toThrow();
    await writeFile(path.join(root, source.sourceFile), "");
    await expect(service.prepare(input)).rejects.toThrow("Source must contain");
  });
});

describe("Mapping compaction HTTP API", () => {
  it("streams the two-pass result and makes its persisted run retrievable", async () => {
    const { root, input } = await fixture();
    vi.stubEnv("NEW_DIAGRAM_AGENT", "fake");
    let middleware: Connect.NextHandleFunction;
    const server = createServer((request, response) => middleware(request, response, () => { response.statusCode = 404; response.end(); }));
    servers.push(server);
    const configure = diagramApi(root).configureServer;
    (configure as (server: unknown) => void)({ middlewares: { use: (handler: Connect.NextHandleFunction) => { middleware = handler; } }, httpServer: server });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/mapping/compactions`;
    const post = (body: unknown) => fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const response = await post(input);
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
    expect(events[0].type).toBe("started");
    expect([...new Set(events.filter((event) => event.type === "progress").map((event) => event.stage))]).toEqual(["compact", "refine"]);
    expect(events.at(-1).type).toBe("result");
    const saved = await (await fetch(`${base}/${events[0].runId}`)).json();
    expect(saved.status).toBe("completed");
    expect(saved.result).toEqual(events.at(-1).result);
    expect((await post({ ...input, projectId: "other" })).status).toBe(409);
    expect((await post({ ...input, sourceFile: "../source.ts" })).status).toBe(400);
    expect((await post({ ...input, systemPrompt: "" })).status).toBe(400);
    expect((await post({ ...input, thinkingLevel: "invalid" })).status).toBe(400);
    const customized = await post({ ...input, modelId: "gpt-6-astra", thinkingLevel: "high", systemPrompt: "Custom API prompt" });
    const customEvents = (await customized.text()).trim().split("\n").map((line) => JSON.parse(line));
    expect(customEvents.at(-1).type).toBe("result");
    const customRun = await (await fetch(`${base}/${customEvents[0].runId}`)).json();
    expect(customRun.agent).toMatchObject({ modelId: "gpt-6-astra", thinkingLevel: "high",
      systemPrompt: { kind: "custom", text: "Custom API prompt" } });
    expect((await fetch(base)).status).toBe(405);
    expect((await fetch(`${base}/compaction-00000000-0000-0000-0000-000000000000`)).status).toBe(404);
    expect((await fetch(`${base}/invalid`)).status).toBe(400);
  });
});
