/** Application failures are independent of their HTTP representation. */
export class ApplicationError extends Error {
  constructor(readonly code: 'conflict' | 'invalid-input' | 'binary-source' | 'lsp-disabled' | 'ai-disabled' | 'storage-unavailable', message: string) {
    super(message);
  }
}

/** Shared guard for every real AI execution adapter, including Codex chat. */
export function requireAiEnabled(enabled: boolean): void {
  if (enabled !== true) throw new ApplicationError(
    'ai-disabled', 'AI execution is disabled; start the server with --pi to enable it.'
  );
}
