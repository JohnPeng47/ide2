/** Application failures are independent of their HTTP representation. */
export class ApplicationError extends Error {
  constructor(readonly code: 'conflict' | 'invalid-input' | 'binary-source' | 'lsp-disabled' | 'storage-unavailable', message: string) {
    super(message);
  }
}
