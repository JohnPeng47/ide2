// Local CDP primitives, based on the front-end validation reference helper.
// Kept in-repo so benchmarks do not depend on a personal skill installation.
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export const DEFAULT_CHROME_PATHS = [
  "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
  "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser"
];

export async function withHeadlessBrowser(options, run) {
  const browser = await launchHeadlessBrowser(options);
  let failure;
  try {
    return await run(browser);
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try { await browser.close(); }
    catch (cleanupError) {
      if (failure) throw new AggregateError([failure, cleanupError], 'Browser test and cleanup failed');
      throw cleanupError;
    }
  }
}

export async function launchHeadlessBrowser({
  url,
  width = 1440,
  height = 900,
  chromePath = DEFAULT_CHROME_PATHS.find(existsSync),
  profileRoot,
  arguments: extraArguments = []
}) {
  if (!url) throw new Error("launchHeadlessBrowser requires a URL");
  if (!chromePath) throw new Error("Chrome or Edge was not found; pass chromePath");

  const windowsBrowser = chromePath.toLowerCase().endsWith(".exe");
  const resolvedProfileRoot = profileRoot
    ?? (windowsBrowser ? "/mnt/c/Windows/Temp/" : tmpdir());
  const profilePath = await mkdtemp(path.join(resolvedProfileRoot, "browser-test-"));
  const browserProfilePath = windowsBrowser
    ? execFileSync("wslpath", ["-w", profilePath], { encoding: "utf8" }).trim()
    : profilePath;
  const process = spawn(chromePath, [
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${browserProfilePath}`,
    `--window-size=${width},${height}`,
    ...extraArguments,
    url
  ], { stdio: "ignore" });

  let cdp;
  try {
    const port = await waitForDevToolsPort(profilePath, process);
    const page = await waitForPage(port, url);
    cdp = await connectCdp(page.webSocketDebuggerUrl);
  } catch (error) {
    if (process.exitCode === null) process.kill();
    try { await removeProfile(profilePath); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Browser startup and cleanup failed'); }
    throw error;
  }

  let closed = false;
  return {
    cdp,
    process,
    profilePath,
    url,
    width,
    height,
    async close() {
      if (closed) return;
      closed = true;
      await cdp.send("Browser.close").catch(() => undefined);
      cdp.close();
      if (process.exitCode === null) {
        await Promise.race([
          new Promise((resolve) => process.once("exit", resolve)),
          delay(1000)
        ]);
      }
      if (process.exitCode === null) process.kill();
      await removeProfile(profilePath);
    }
  };
}

export async function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  const eventHandlers = new Map();
  let nextId = 1;
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method) {
      for (const handler of eventHandlers.get(message.method) ?? []) handler(message.params);
    }
    if (!message.id) return;
    const handler = pending.get(message.id);
    if (!handler) return;
    pending.delete(message.id);
    clearTimeout(handler.timer);
    if (message.error) handler.reject(new Error(message.error.message));
    else handler.resolve(message.result);
  });
  socket.addEventListener("close", () => {
    for (const handler of pending.values()) { clearTimeout(handler.timer); handler.reject(new Error("CDP connection closed")); }
    pending.clear();
  });
  return {
    send(method, params = {}) {
      const id = nextId;
      nextId += 1;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => {
        const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP request timed out: ${method}`));},30000);
        pending.set(id, { resolve, reject, timer });
      });
    },
    on(method, handler) {
      const handlers = eventHandlers.get(method) ?? new Set();
      handlers.add(handler);
      eventHandlers.set(method, handlers);
      return () => handlers.delete(handler);
    },
    close() {
      socket.close();
    }
  };
}

export async function evaluate(cdp, expression, {
  awaitPromise = true,
  returnByValue = true
} = {}) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return returnByValue ? result.result.value : result.result;
}

export async function waitFor(predicate, {
  timeoutMs = 5000,
  intervalMs = 50,
  message = "Timed out waiting for browser state"
} = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(intervalMs);
  }
  throw new Error(message);
}

export async function waitForSelector(cdp, selector, options = {}) {
  await waitFor(
    () => evaluate(cdp, `Boolean(document.querySelector(${JSON.stringify(selector)}))`),
    { ...options, message: options.message ?? `Timed out waiting for ${selector}` }
  );
}

export async function captureScreenshot(cdp, {
  output,
  format = "png",
  quality,
  clip,
  captureBeyondViewport = false
} = {}) {
  const result = await cdp.send("Page.captureScreenshot", {
    format,
    fromSurface: true,
    captureBeyondViewport,
    ...(quality === undefined ? {} : { quality }),
    ...(clip ? { clip } : {})
  });
  const image = Buffer.from(result.data, "base64");
  if (output) {
    await mkdir(path.dirname(path.resolve(output)), { recursive: true });
    await writeFile(output, image);
  }
  return image;
}

export function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForDevToolsPort(profilePath, process) {
  const activePortPath = path.join(profilePath, "DevToolsActivePort");
  await waitFor(async () => {
    if (process.exitCode !== null) throw new Error(`Browser exited with ${process.exitCode}`);
    return existsSync(activePortPath);
  }, { message: "Timed out waiting for the Chrome DevTools port" });
  const [port] = (await readFile(activePortPath, "utf8")).split(/\r?\n/);
  if (!port) throw new Error("Chrome DevTools port file was empty");
  return Number(port);
}

async function waitForPage(port, expectedUrl) {
  let selectedPage;
  await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`).catch(() => null);
    if (!response?.ok) return false;
    const pages = await response.json();
    selectedPage = pages.find((page) => page.type === "page" && page.url === expectedUrl)
      ?? pages.find((page) => page.type === "page");
    return Boolean(selectedPage);
  }, { message: "Timed out waiting for the Chrome page target" });
  return selectedPage;
}

async function removeProfile(profilePath) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(profilePath, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 9) throw error;
      await delay(100);
    }
  }
}
