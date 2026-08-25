import { execFile, execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
async function loadBrowserHarness() {
  const candidates = [
    new URL("../../.agents/skills/front-end/browser-test.mjs", import.meta.url),
    new URL("../../../../.codex/skills/front-end/browser-test.mjs", import.meta.url)
  ];
  for (const candidate of candidates) {
    try {
      return await import(candidate.href);
    } catch (error) {
      if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
    }
  }
  throw new Error("front-end browser test harness was not found");
}

const {
  captureScreenshot,
  elementClip,
  evaluate,
  waitFor,
  waitForSelector,
  withHeadlessBrowser
} = await loadBrowserHarness();

const packageRoot = path.dirname(new URL(import.meta.url).pathname);
const execFileAsync = promisify(execFile);

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function click(cdp, selector) {
  const clip = await elementClip(cdp, selector);
  const x = clip.x + clip.width / 2;
  const y = clip.y + clip.height / 2;
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

async function replaceText(cdp, selector, value) {
  await click(cdp, selector);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Control", code: "ControlLeft", modifiers: 2 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 2 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Control", code: "ControlLeft" });
  await cdp.send("Input.insertText", { text: value });
}

const fixtureRoot = await mkdtemp(path.join(tmpdir(), "new-diagram-aux-browser-"));
const screenshotPath = path.join(fixtureRoot, "aux-views.png");
let serverProcess;

try {
  execFileSync("git", ["init", "-q", fixtureRoot]);
  await writeFile(
    path.join(fixtureRoot, "fixture.ts"),
    "export function entry() {\n  return worker();\n}\nexport function worker() { return true; }\n",
    "utf8"
  );
  execFileSync("git", ["-C", fixtureRoot, "add", "fixture.ts"]);
  execFileSync("git", ["-C", fixtureRoot, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"]);

  const port = await freePort();
  const url = `http://127.0.0.1:${port}/`;
  serverProcess = spawn("npm", ["run", "preview", "--", "--port", String(port), "--strictPort"], {
    cwd: packageRoot,
    env: { ...process.env, NEW_DIAGRAM_AGENT: "fake", NEW_DIAGRAM_PROJECT_ROOT: fixtureRoot },
    stdio: "ignore"
  });
  await waitFor(async () => Boolean((await fetch(url).catch(() => null))?.ok), {
    timeoutMs: 10000,
    message: "preview server did not start"
  });

  await withHeadlessBrowser({ url, width: 1440, height: 900 }, async ({ cdp }) => {
    await cdp.send("Page.enable");
    await waitForSelector(cdp, ".empty-workspace");
    await execFileAsync("npm", [
      "run", "diagram", "--", "create",
      "--path", fixtureRoot,
      "--name", "Auxiliary views",
      "--prompt", "Show entry and worker flow",
      "--server", url
    ], { cwd: packageRoot, env: { ...process.env, NEW_DIAGRAM_AGENT: "fake" }, encoding: "utf8" });
    await waitForSelector(cdp, ".diagram-panel", { timeoutMs: 10000 });

    const mainName = await evaluate(cdp, `document.querySelector('.diagram-heading h2').textContent`);
    await click(cdp, ".diagram-star-toggle");
    await waitFor(async () => await evaluate(cdp, `document.querySelector('.diagram-star-toggle').getAttribute('aria-pressed') === 'true'`), {
      message: "main diagram was not starred"
    });

    await click(cdp, ".diagram-view-tabs button:nth-child(2)");
    await waitForSelector(cdp, ".diagram-empty-state");
    if (!(await evaluate(cdp, `document.querySelector('.diagram-empty-state').textContent.includes('Generate the first call graph')`))) {
      throw new Error("call-graph empty state was not rendered");
    }
    await click(cdp, ".diagram-view-tabs button:first-child");
    await click(cdp, ".create-derivative");
    await waitForSelector(cdp, ".prompt-field textarea");
    if (!(await evaluate(cdp, `document.querySelector('.output-kind button:nth-of-type(3)').disabled`))) {
      throw new Error("directory generation was enabled before a Call Graph was starred");
    }
    await replaceText(cdp, ".prompt-field textarea", "---- PREVIOUS PROMPT ----\nInherited diagram request\n-------------------------\n\nNew correction");
    await click(cdp, ".output-kind button:nth-of-type(2)");
    await waitForSelector(cdp, ".generation-foundation");
    const callSetup = await evaluate(cdp, `({
      output: document.querySelector('.output-kind [aria-checked="true"]').textContent.trim(),
      foundation: document.querySelector('.generation-foundation').textContent,
      immutableContext: document.querySelector('.generation-immutable-context').textContent,
      instruction: document.querySelector('.prompt-field textarea').value,
      hasEntityCheckbox: Boolean(document.querySelector('.entity-context__toggle'))
    })`);
    if (callSetup.output !== "Call Graph"
      || !callSetup.foundation.includes(mainName)
      || !callSetup.immutableContext.includes("CODE ENTITIES")
      || callSetup.instruction !== "Generate an ASCII call graph based on the foundation diagram."
      || callSetup.instruction.includes("PREVIOUS PROMPT")
      || callSetup.hasEntityCheckbox) {
      throw new Error(`call-graph generation foundation was incomplete: ${JSON.stringify(callSetup)}`);
    }
    await click(cdp, '[aria-label="Use one fewer agent"]');
    await click(cdp, '[aria-label="Use one fewer agent"]');
    await click(cdp, ".generate-action");
    await waitFor(async () => await evaluate(cdp, `document.querySelector('.diagram-meta')?.textContent.includes('[CALL-GRAPH]')`), {
      timeoutMs: 10000,
      message: "call graph was not generated and selected"
    });
    const callGraphName = await evaluate(cdp, `document.querySelector('.diagram-heading h2').textContent`);
    await click(cdp, ".diagram-star-toggle");
    await waitFor(async () => await evaluate(cdp, `(async () => {
      const workspace = await fetch('/api/workspace').then((response) => response.json());
      return Boolean(workspace.diagramSets[0].featuredViewIds['call-graph']);
    })()`), { message: "call graph star was not persisted" });
    const callPromptContext = await evaluate(cdp, `(async () => {
      const workspace = await fetch('/api/workspace').then((response) => response.json());
      const diagram = Object.values(workspace.diagrams).find((candidate) => candidate.viewKind === 'call-graph');
      return workspace.generationPromptConfigs[diagram.generationPromptConfigId].contextPrompt.rendered;
    })()`);
    if (!callPromptContext.includes("Immutable CodeEntities:")
      || callPromptContext.includes("Show entry and worker flow")
      || callPromptContext.includes("PREVIOUS PROMPT")) {
      throw new Error("call-graph model context was not isolated from previous prompts");
    }

    await click(cdp, ".diagram-view-tabs button:nth-child(3)");
    await waitForSelector(cdp, ".diagram-empty-state");
    await click(cdp, ".diagram-empty-state .button--primary");
    await waitForSelector(cdp, ".generation-foundation");
    const directorySetup = await evaluate(cdp, `({
      instruction: document.querySelector('.prompt-field textarea').value,
      immutableContext: document.querySelector('.generation-immutable-context').textContent,
      hasEntityCheckbox: Boolean(document.querySelector('.entity-context__toggle'))
    })`);
    if (directorySetup.instruction !== "Generate an ASCII directory view based on the foundation diagram."
      || !directorySetup.immutableContext.includes("CODE ENTITIES")
      || !directorySetup.immutableContext.includes("COMPANION CALL GRAPH")
      || !directorySetup.immutableContext.includes(callGraphName)
      || !directorySetup.immutableContext.includes("REPOSITORY PATHS")
      || directorySetup.hasEntityCheckbox) {
      throw new Error(`directory generation context was incomplete: ${JSON.stringify(directorySetup)}`);
    }
    await click(cdp, '[aria-label="Use one fewer agent"]');
    await click(cdp, '[aria-label="Use one fewer agent"]');
    await click(cdp, ".generate-action");
    await waitFor(async () => await evaluate(cdp, `document.querySelector('.diagram-meta')?.textContent.includes('[DIR-VIEW]')`), {
      timeoutMs: 10000,
      message: "directory view was not generated and selected"
    });
    const directoryPromptInputs = await evaluate(cdp, `(async () => {
      const workspace = await fetch('/api/workspace').then((response) => response.json());
      const diagram = Object.values(workspace.diagrams).find((candidate) => candidate.viewKind === 'dir-view');
      const config = workspace.generationPromptConfigs[diagram.generationPromptConfigId];
      return {
        referenceKinds: config.references.map((reference) => workspace.diagrams[reference.targetId]?.viewKind),
        context: config.contextPrompt.rendered
      };
    })()`);
    if (directoryPromptInputs.referenceKinds.join(",") !== "diagram,call-graph"
      || !directoryPromptInputs.context.includes("Immutable companion Call Graph:")) {
      throw new Error(`directory prompt did not inject both prerequisite views: ${JSON.stringify(directoryPromptInputs.referenceKinds)}`);
    }
    await click(cdp, ".diagram-star-toggle");
    await waitFor(async () => await evaluate(cdp, `(async () => {
      const workspace = await fetch('/api/workspace').then((response) => response.json());
      const featured = workspace.diagramSets[0].featuredViewIds;
      return Boolean(featured.diagram && featured['call-graph'] && featured['dir-view']);
    })()`), { message: "independent view stars were not persisted" });

    await click(cdp, ".diagram-view-tabs button:first-child");
    await waitFor(async () => (await evaluate(cdp, `document.querySelector('.diagram-heading h2').textContent`)) === mainName, {
      message: "Diagram tab did not return to the starred main diagram"
    });
    await click(cdp, ".diagram-view-tabs button:nth-child(2)");
    await waitFor(async () => await evaluate(cdp, `document.querySelector('.diagram-meta').textContent.includes('[CALL-GRAPH]')`), {
      message: "Call Graph tab did not show its starred candidate"
    });
    await click(cdp, ".diagram-view-tabs button:nth-child(3)");
    await waitFor(async () => await evaluate(cdp, `document.querySelector('.diagram-meta').textContent.includes('[DIR-VIEW]')`), {
      message: "Dir View tab did not show its starred candidate"
    });
    await captureScreenshot(cdp, { output: screenshotPath });

    await cdp.send("Page.reload", { ignoreCache: true });
    await waitForSelector(cdp, ".diagram-view-tabs", { timeoutMs: 10000 });
    await click(cdp, ".diagram-view-tabs button:nth-child(2)");
    await waitFor(async () => await evaluate(cdp, `document.querySelector('.diagram-meta').textContent.includes('[CALL-GRAPH]')`), {
      message: "starred call graph did not survive reload"
    });
  });

  if ((await readFile(screenshotPath)).length < 1000) {
    throw new Error("auxiliary view screenshot was unexpectedly small");
  }
  process.stdout.write("auxiliary view browser check passed: empty -> generate -> star -> toggle -> reload\n");
} finally {
  if (serverProcess?.exitCode === null) serverProcess.kill("SIGTERM");
  await rm(fixtureRoot, { recursive: true, force: true });
}
