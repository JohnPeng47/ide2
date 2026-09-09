import { seedMappingFixture } from "./browser-mapping-fixture.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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
    type: "mousePressed", x: start.x, y: start.y, button: "left", buttons: 1, clickCount: 1
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved", x: end.x, y: end.y, button: "left", buttons: 1
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: end.x, y: end.y, button: "left", buttons: 0, clickCount: 1
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

try {
  await seedMappingFixture(tempRoot);
  serverProcess = spawn("npm", ["run", "preview", "--", "--port", String(port), "--strictPort"], {
    cwd: PACKAGE_ROOT,
    env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: tempRoot },
    stdio: "ignore"
  });
  await waitFor(async () => Boolean((await fetch(url).catch(() => null))?.ok), {
    timeoutMs: 10000,
    message: "local chat preview server did not start"
  });

  await withHeadlessBrowser({ url, width: 1600, height: 1000 }, async ({ cdp }) => {
    await cdp.send("Page.enable");
    await cdp.send("Network.enable");
    const apiRequests = [];
    const stopTrackingRequests = cdp.on("Network.requestWillBeSent", ({ request }) => {
      if (new URL(request.url).pathname.startsWith("/api/")) apiRequests.push(request.url);
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
    await cdp.send("Input.insertText", { text: "What contract does this prompt block define?" });
    await key(cdp, "Enter", "Enter", 13, 2);
    await waitForSelector(cdp, "[data-local-chat-placement='pending']");

    const pre = await rect(cdp, ".mapping-poc-ascii");
    await click(cdp, { x: pre.x + pre.width * 0.72, y: node.y + node.height + 40 });
    await waitForSelector(cdp, "[data-local-chat-bubble]");
    await waitFor(async () => await evaluate(cdp,
      "document.querySelectorAll('[data-local-chat-role=assistant]').length === 0 && !document.querySelector('[data-local-chat-placement]') && !document.querySelector('[data-local-chat-source-highlight]')"
    ), { message: "bubble was not placed in its collapsed state" });
    await click(cdp, "[data-local-chat-bubble]");
    await waitForSelector(cdp, "[data-local-chat-convo='compact']");
    await waitForSelector(cdp, "[data-local-chat-source-highlight]");
    await waitFor(async () => await evaluate(cdp,
      "document.querySelectorAll('[data-local-chat-role=assistant]').length === 1"
    ), { timeoutMs: 5000, message: "first mocked local-chat response did not arrive" });
    const firstReply = await evaluate(cdp,
      "document.querySelector('[data-local-chat-role=assistant] p')?.textContent"
    );
    if (!firstReply?.includes("experiment manifest")) throw new Error(`unexpected first mock reply: ${firstReply}`);
    await captureScreenshot(cdp, { output: path.join(screenshotRoot, "local-chat-compact.png") });

    await click(cdp, "[data-local-chat-convo='compact'] textarea");
    await cdp.send("Input.insertText", { text: "And where does its source context come from?" });
    await key(cdp, "Enter", "Enter", 13, 2);
    await waitFor(async () => await evaluate(cdp,
      "document.querySelectorAll('[data-local-chat-role=assistant]').length === 2"
    ), { timeoutMs: 5000, message: "follow-up mocked response did not arrive" });
    const secondReply = await evaluate(cdp,
      "Array.from(document.querySelectorAll('[data-local-chat-role=assistant] p')).at(-1)?.textContent"
    );
    if (!secondReply?.includes("mapped corpus ranges")) throw new Error(`unexpected second mock reply: ${secondReply}`);

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
    await click(cdp, ".local-chat-docked-shell button[aria-label='Collapse local conversation']");
    await waitFor(async () => await evaluate(cdp,
      "!document.querySelector('[data-local-chat-convo]') && !document.querySelector('[data-local-chat-source-highlight]')"
    ), { message: "collapsing the conversation did not dismiss its source highlight" });
    stopTrackingRequests();
    if (apiRequests.length) throw new Error(`Mapping made API requests: ${JSON.stringify(apiRequests)}`);
  });

  console.log("local chat browser check passed (compact, floating, docked; mock replies wrapped through shared seam)");
} finally {
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
    await new Promise((resolve) => serverProcess.once("exit", resolve));
  }
  await rm(tempRoot, { recursive: true, force: true });
}
