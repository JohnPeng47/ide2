import { seedMappingFixture } from "./browser-mapping-fixture.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import path from "node:path";

async function loadBrowserHarness() {
  const candidates = [
    path.join(homedir(), ".codex/skills/front-end/browser-test.mjs"),
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

const { captureScreenshot, evaluate, waitFor, waitForSelector, withHeadlessBrowser } = await loadBrowserHarness();
const PACKAGE_ROOT = path.dirname(new URL(import.meta.url).pathname);

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

async function rect(cdp, selector) {
  const result = await evaluate(cdp, `(() => {
    const rect = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();
    return rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  })()`);
  if (!result) throw new Error(`missing element: ${selector}`);
  return result;
}

async function click(cdp, selectorOrPoint) {
  const box = typeof selectorOrPoint === "string" ? await rect(cdp, selectorOrPoint) : null;
  const point = box
    ? { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    : selectorOrPoint;
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1
  });
}

async function drag(cdp, start, end) {
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x: start.x, y: start.y, button: "left", modifiers: 2, buttons: 1, clickCount: 1
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved", x: end.x, y: end.y, button: "left", modifiers: 2, buttons: 1
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: end.x, y: end.y, button: "left", modifiers: 2, buttons: 0, clickCount: 1
  });
}

async function key(cdp, keyName, code, keyCode, modifiers = 0) {
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown", key: keyName, code, modifiers, windowsVirtualKeyCode: keyCode
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp", key: keyName, code, modifiers, windowsVirtualKeyCode: keyCode
  });
}

async function chooseNextVariant(cdp, expected) {
  const expanded = await evaluate(cdp, "document.querySelector('[data-ui-test-dial]')?.getAttribute('aria-expanded')");
  if (expanded !== "true") await click(cdp, "[data-ui-test-dial]");
  await waitForSelector(cdp, "[data-ui-test-control='variant'] select");
  await click(cdp, "[data-ui-test-control='variant'] select");
  await key(cdp, "ArrowDown", "ArrowDown", 40);
  await key(cdp, "Enter", "Enter", 13);
  await waitFor(async () => await evaluate(cdp,
    `document.querySelector('.mapping-poc-shell')?.dataset.localChatVariant === ${JSON.stringify(expected)}`
  ), { message: `local chat did not switch to ${expected}` });
}

const tempRoot = await mkdtemp(path.join(tmpdir(), "new-diagram-local-chat-"));
const screenshotRoot = process.env.LOCAL_CHAT_SCREENSHOT_DIR
  ? path.resolve(process.env.LOCAL_CHAT_SCREENSHOT_DIR)
  : tempRoot;
await mkdir(screenshotRoot, { recursive: true });
const port = await freePort();
const url = `http://127.0.0.1:${port}/mapping`;
let serverProcess;
let serverError = "";

try {
  await seedMappingFixture(tempRoot);
  serverProcess = spawn(process.execPath, [path.join(PACKAGE_ROOT, "node_modules/vite/bin/vite.js"), "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: PACKAGE_ROOT,
    env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: tempRoot, NEW_DIAGRAM_AGENT: "fake" },
    stdio: ["ignore", "ignore", "pipe"]
  });
  serverProcess.stderr.on("data", (chunk) => { serverError = (serverError + chunk).slice(-4000); });
  await waitFor(async () => {
    if (serverProcess.exitCode !== null) throw new Error(`Preview exited: ${serverError}`);
    return Boolean((await fetch(url).catch(() => null))?.ok);
  }, {
    timeoutMs: 10000,
    message: "local chat preview server did not start"
  });

  await withHeadlessBrowser({ url, width: 1600, height: 1000 }, async ({ cdp }) => {
    await cdp.send("Page.enable");
    await cdp.send("Network.enable");
    const apiRequests = [];
    const stopTrackingRequests = cdp.on("Network.requestWillBeSent", ({ request }) => {
      if (new URL(request.url).pathname.startsWith("/api/")) apiRequests.push({ url: request.url, body: request.postData ? JSON.parse(request.postData) : undefined });
    });
    await cdp.send("Page.reload", { ignoreCache: true });
    await waitForSelector(cdp, "[data-selectable-node='overview:a-system-templates:range-1']");
    await waitFor(async () => {
      const transform = await evaluate(cdp, "document.querySelector('.diagram-canvas__surface')?.style.transform");
      return typeof transform === "string" && transform.includes("translate3d(");
    }, { message: "mapping canvas did not initialize" });

    const node = await rect(cdp, "[data-selectable-node='overview:a-system-templates:range-1']");
    await drag(cdp,
      { x: node.x + 2, y: node.y + node.height / 2 },
      { x: node.x + node.width - 2, y: node.y + node.height / 2 }
    );
    await waitForSelector(cdp, ".mapping-poc-selection-menu .is-ask");
    await click(cdp, ".mapping-poc-selection-menu .is-ask");
    await waitForSelector(cdp, "[data-local-chat-ask='compact'] textarea");
    await click(cdp, "[data-local-chat-ask='compact'] textarea");
    await cdp.send("Input.insertText", { text: "What contract does **this prompt** define? Use `source context`.\n\n- First point\n- Second point\n\n```typescript\nconst ready = true;\n```\n\n" });
    await key(cdp, "Enter", "Enter", 13, 2);
    await waitForSelector(cdp, "[data-local-chat-bubble]");
    const placement = await evaluate(cdp, `(() => {
      const bubble = document.querySelector('[data-local-chat-bubble]').getBoundingClientRect();
      const source = document.querySelector('[data-local-chat-source-highlight]').getBoundingClientRect();
      return { dx: bubble.x + bubble.width / 2 - source.right, dy: bubble.y + bubble.height / 2 - source.top,
        guide: Boolean(document.querySelector('[data-local-chat-placement]')) };
    })()`);
    if (Math.abs(placement.dx) > 1 || Math.abs(placement.dy) > 1 || placement.guide) throw new Error(`bad automatic placement: ${JSON.stringify(placement)}`);
    await waitForSelector(cdp, "[data-local-chat-convo='compact']");
    await waitForSelector(cdp, "[data-local-chat-source-highlight]");
    await waitFor(async () => await evaluate(cdp,
      "document.querySelectorAll('[data-local-chat-role=assistant]').length === 1"
    ), { timeoutMs: 5000, message: "first server local-chat response did not arrive" });
    await waitForSelector(cdp, "[data-local-chat-role=assistant] [data-rendered-markdown] pre code");
    const markdown = await evaluate(cdp, `(() => {
      const body = document.querySelector('[data-local-chat-role=assistant] .local-chat-markdown');
      return { bold: body.querySelector('strong')?.textContent, code: body.querySelector('p code')?.textContent,
        items: body.querySelectorAll('li').length, highlighted: Boolean(body.querySelector('.shiki')),
        userBold: Boolean(document.querySelector('[data-local-chat-role=user] strong')) };
    })()`);
    if (markdown.bold !== 'this prompt' || markdown.code !== 'source context' || markdown.items !== 2
      || !markdown.highlighted || markdown.userBold) throw new Error(`Markdown was not rendered correctly: ${JSON.stringify(markdown)}`);
    const firstReply = await evaluate(cdp,
      "document.querySelector('[data-local-chat-role=assistant] .local-chat-markdown')?.textContent"
    );
    if (!firstReply?.includes("1 messages") || !firstReply?.includes("low")) throw new Error(`unexpected first mock reply: ${firstReply}`);
    await captureScreenshot(cdp, { output: path.join(screenshotRoot, "local-chat-compact.png") });

    const highButton = await evaluate(cdp, `(() => {
      const buttons = Array.from(document.querySelectorAll('[data-local-chat-convo] .local-chat-verbosity button'));
      const r = buttons.find(b => b.textContent === 'High').getBoundingClientRect();
      return {x: r.x+r.width/2, y: r.y+r.height/2};
    })()`);
    await click(cdp, highButton);
    await click(cdp, "[data-local-chat-convo='compact'] textarea");
    await cdp.send("Input.insertText", { text: "And where does its source context come from?" });
    await key(cdp, "Enter", "Enter", 13, 2);
    await waitFor(async () => await evaluate(cdp,
      "document.querySelectorAll('[data-local-chat-role=assistant]').length === 2"
    ), { timeoutMs: 5000, message: "follow-up mocked response did not arrive" });
    const secondReply = await evaluate(cdp,
      "Array.from(document.querySelectorAll('[data-local-chat-role=assistant] p')).at(-1)?.textContent"
    );
    if (!secondReply?.includes("3 messages") || !secondReply?.includes("high")) throw new Error(`unexpected second mock reply: ${secondReply}`);

    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/mapping/chat", requestStage: "Request" }] });
    const stopFailing = cdp.on("Fetch.requestPaused", ({ requestId }) => {
      void cdp.send("Fetch.failRequest", { requestId, errorReason: "ConnectionFailed" });
    });
    await click(cdp, "[data-local-chat-convo='compact'] textarea");
    await cdp.send("Input.insertText", { text: "Can you explain that again?" });
    await key(cdp, "Enter", "Enter", 13, 2);
    await waitForSelector(cdp, ".local-chat-error button");
    if (await evaluate(cdp, "document.querySelectorAll('[data-local-chat-role=assistant]').length") !== 2) throw new Error('network error was added to assistant history');
    stopFailing();
    await cdp.send("Fetch.disable");
    await click(cdp, ".local-chat-error button");
    await waitFor(async () => await evaluate(cdp,
      "document.querySelectorAll('[data-local-chat-role=assistant]').length === 3 && !document.querySelector('.local-chat-error')"
    ), { message: 'retry did not recover the failed turn' });
    if (await evaluate(cdp, "document.querySelectorAll('[data-local-chat-role=user]').length") !== 3) throw new Error('retry duplicated the user query');

    const beforeZoom = await evaluate(cdp, "document.querySelector('[aria-label=\"Diagram zoom\"]').textContent");
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: node.x + 20, y: node.y + 180, deltaX: 0, deltaY: -100, modifiers: 2 });
    await waitFor(async () => (await evaluate(cdp, "document.querySelector('[aria-label=\"Diagram zoom\"]').textContent")) !== beforeZoom);
    const aligned = await evaluate(cdp, `(() => {
      const bubble = document.querySelector('[data-local-chat-bubble]').getBoundingClientRect();
      const source = document.querySelector('[data-local-chat-source-highlight]').getBoundingClientRect();
      return Math.abs(bubble.x+bubble.width/2-source.right) < 1 && Math.abs(bubble.y+bubble.height/2-source.top) < 1;
    })()`);
    if (!aligned) throw new Error('marker drifted after zoom');

    await chooseNextVariant(cdp, "floating");
    await waitForSelector(cdp, "[data-local-chat-convo='floating']");
    const floatingWidth = (await rect(cdp, "[data-local-chat-convo='floating']")).width;
    if (floatingWidth < 390) throw new Error(`floating conversation is too narrow: ${floatingWidth}`);
    await captureScreenshot(cdp, { output: path.join(screenshotRoot, "local-chat-floating.png") });

    await chooseNextVariant(cdp, "docked");
    await waitForSelector(cdp, ".local-chat-docked-shell [data-local-chat-convo='docked']");
    const docked = await evaluate(cdp, `(() => {
      const shell = document.querySelector('.local-chat-docked-shell');
      const rect = shell?.getBoundingClientRect();
      return rect && { right: innerWidth - rect.right, height: rect.height, viewportHeight: innerHeight, position: getComputedStyle(shell).position };
    })()`);
    if (docked?.position !== "fixed" || docked.right > 20 || docked.height < docked.viewportHeight * 0.75) {
      throw new Error(`docked conversation did not occupy the right edge: ${JSON.stringify(docked)}`);
    }
    await captureScreenshot(cdp, { output: path.join(screenshotRoot, "local-chat-docked.png") });
    await click(cdp, "[data-local-chat-convo='docked'] textarea");
    await cdp.send("Input.insertText", { text: "Continue with the same context after reload." });
    await click(cdp, '.mapping-workspace-actions button:first-child');
    await waitFor(async () => await evaluate(cdp, "document.querySelector('.mapping-poc-status').textContent.includes('Workspace saved')"));
    const saved = await (await fetch(new URL('/api/mapping/workspace', url))).json();
    const conversation = Object.values(saved.documents[0].canvas.display.nodes).find(node => node.kind === 'conversation');
    if (saved.schemaVersion !== 3 || conversation.coordinateSpace !== 'viewport' || conversation.thread.anchor) {
      throw new Error('conversation geometry was not persisted in the display node');
    }
    const owner = Object.values(saved.documents[0].canvas.display.nodes).find(node => node.childIds.includes(conversation.id));
    if (owner?.kind !== 'selection' || conversation.thread.verbosity !== 'high'
      || !conversation.thread.context.sourceRanges?.length || conversation.thread.messages.length !== 6
      || conversation.draft !== 'Continue with the same context after reload.') {
      throw new Error('workspace lost retained ownership, conversation context, verbosity, history, or draft');
    }
    const savedPose = await evaluate(cdp, `(() => { const shell = document.querySelector('.local-chat-docked-shell');
      return { x: shell.offsetLeft, y: shell.offsetTop, width: shell.offsetWidth, height: shell.offsetHeight }; })()`);
    if (JSON.stringify(savedPose) !== JSON.stringify({ ...conversation.position, ...conversation.bounds })) throw new Error('docked geometry differs from saved allocation');
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitForSelector(cdp, '.local-chat-docked-shell [data-local-chat-convo="docked"]');
    const restoredPose = await evaluate(cdp, `(() => { const shell = document.querySelector('.local-chat-docked-shell');
      return { x: shell.offsetLeft, y: shell.offsetTop, width: shell.offsetWidth, height: shell.offsetHeight }; })()`);
    if (JSON.stringify(restoredPose) !== JSON.stringify(savedPose)) throw new Error('docked allocation did not survive reload');
    const restoredDraft = await evaluate(cdp, "document.querySelector('[data-local-chat-convo=docked] textarea').value");
    if (restoredDraft !== conversation.draft) throw new Error('composer draft did not survive reload');
    await click(cdp, "[data-local-chat-convo='docked'] textarea");
    await key(cdp, "Enter", "Enter", 13, 2);
    await waitFor(async () => await evaluate(cdp,
      "document.querySelectorAll('[data-local-chat-role=assistant]').length === 4"
    ), { message: 'restored conversation could not continue' });
    await click(cdp, ".local-chat-docked-shell button[aria-label='Collapse local conversation']");
    await waitFor(async () => await evaluate(cdp,
      "!document.querySelector('[data-local-chat-convo]') && !document.querySelector('[data-local-chat-source-highlight]')"
    ), { message: "collapsing the conversation did not dismiss its source highlight" });
    stopTrackingRequests();
    const chats = apiRequests.filter(r => new URL(r.url).pathname === '/api/mapping/chat');
    if (chats.length !== 5) throw new Error(`expected 5 chat requests, got ${chats.length}`);
    if (chats[0].body.context.contentId !== 'overview' || !chats[0].body.context.diagramAscii.includes('CurrentLLMPromptStack')) throw new Error('wrong diagram context');
    if (!chats[1].body.context.sourceRanges?.length || chats[1].body.history.length !== 3 || chats[1].body.verbosity !== 'high') throw new Error('follow-up did not preserve context/history/verbosity');
    if (chats[3].body.history.length !== 5) throw new Error('retry lost or duplicated history');
    if (chats[4].body.history.length !== 7 || chats[4].body.verbosity !== 'high'
      || JSON.stringify(chats[4].body.context) !== JSON.stringify(chats[1].body.context)) {
      throw new Error('restored follow-up lost the original context, history, or verbosity');
    }
  });

  console.log("local chat browser check passed (compact, floating, docked; automatic placement, HTTP replies, context snapshots and verbosity)");
} finally {
  if (serverProcess && serverProcess.exitCode === null && serverProcess.signalCode === null) {
    const exited = new Promise((resolve) => serverProcess.once("exit", resolve));
    serverProcess.kill("SIGTERM");
    await exited;
  }
  await rm(tempRoot, { recursive: true, force: true });
}
