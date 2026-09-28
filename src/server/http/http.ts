import type { ServerResponse } from "node:http";
import type { Connect } from "vite";
const MAX_REQUEST_BYTES = 10 * 1024 * 1024;
export class RequestTooLarge extends Error {}

export function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

export function sendEvent(response: ServerResponse, payload: unknown): void {
  if (!response.destroyed && !response.writableEnded) {
    response.write(`${JSON.stringify(payload)}\n`);
  }
}

export function readBody(request: Connect.IncomingMessage, maxBytes = MAX_REQUEST_BYTES): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    let bytes = 0;
    let exceeded = false;
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      if (exceeded) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > maxBytes) {
        exceeded = true; body = '';
        reject(new RequestTooLarge(`Request exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB save limit`));
        return; // Drain the request so the client receives a useful HTTP error.
      }
      body += chunk;
    });
    request.on("end", () => {
      if (exceeded) return;
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("request body is not valid JSON"));
      }
    });
    request.on("error", reject);
  });
}
