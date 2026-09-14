import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CancellationTokenSource, createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node.js';
import type { CorpusBinding } from '../../src/core/domainProfile';
import { isRepositoryFilePath, supportsDefinitions, type SourceDefinitions, type SourceLocation, type SourcePosition } from '../../src/core/sourceNavigation';
import { corpusProvider } from './corpus';
const require = createRequire(import.meta.url);
const liveSessions = new Set<LanguageSession>();
let signalHandlersInstalled = false;
function registerSession(session: LanguageSession) {
  liveSessions.add(session);
  if (signalHandlersInstalled) return;
  signalHandlersInstalled = true;
  for (const [signal, code] of [['SIGTERM', 143], ['SIGINT', 130]] as const) {
    process.once(signal, () => { for (const session of liveSessions) session.dispose(); process.exit(code); });
  }
}

class LanguageSession {
  private readonly child;
  private readonly rpc;
  private readonly ready: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private idle?: ReturnType<typeof setTimeout>;
  dead = false;
  constructor(readonly root: string) {
    const cli = path.join(path.dirname(require.resolve('typescript-language-server/package.json')), 'lib/cli.mjs');
    this.child = spawn(process.execPath, [cli, '--stdio', '--log-level', '1'], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    this.child.stderr.resume();
    this.rpc = createMessageConnection(new StreamMessageReader(this.child.stdout), new StreamMessageWriter(this.child.stdin));
    this.rpc.onRequest('workspace/configuration', (params: { items: unknown[] }) => params.items.map(() => ({})));
    this.rpc.onRequest('client/registerCapability', () => null);
    this.rpc.onRequest('workspace/applyEdit', () => ({ applied: false }));
    this.rpc.onError(() => this.dispose());
    this.child.on('error', () => this.dispose());
    this.child.on('exit', () => this.dispose());
    this.rpc.listen();
    registerSession(this);
    this.ready = this.bounded(async () => {
      const capabilities = await this.rpc.sendRequest<{ capabilities: { definitionProvider?: unknown; positionEncoding?: string } }>('initialize', {
        processId: process.pid, rootUri: pathToFileURL(root).href,
        capabilities: { general: { positionEncodings: ['utf-16'] }, textDocument: { definition: { linkSupport: true } } },
        workspaceFolders: [{ uri: pathToFileURL(root).href, name: path.basename(root) }],
        initializationOptions: { tsserver: { useSyntaxServer: 'never', path: require.resolve('typescript/lib/tsserver.js') } }
      });
      if (!capabilities.capabilities.definitionProvider || (capabilities.capabilities.positionEncoding && capabilities.capabilities.positionEncoding !== 'utf-16')) {
        throw new Error('Language server does not support UTF-16 definition lookup');
      }
      await this.rpc.sendNotification('initialized', {});
    });
    // Initialization may fail before the first queued request attaches.
    void this.ready.then(() => {
      this.scheduleIdle();
    }, () => this.dispose());
  }
  private scheduleIdle() {
    clearTimeout(this.idle);
    if (this.dead) return;
    this.idle = setTimeout(() => this.dispose(), 5 * 60_000);
    this.idle.unref();
  }
  private async bounded<T>(run: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([run(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { reject(new Error('Language server timed out; try again')); this.dispose(); }, 20000);
      })]);
    } finally { clearTimeout(timer); }
  }
  lookup(file: string, text: string, position: SourcePosition, signal?: AbortSignal): Promise<unknown> {
    const run = async () => {
      clearTimeout(this.idle);
      try {
        await this.ready;
        if (this.dead) throw new Error('Language server stopped; try again');
        signal?.throwIfAborted();
        const uri = pathToFileURL(path.join(this.root, file)).href;
        const cancellation = new CancellationTokenSource();
        const abort = () => cancellation.cancel();
        signal?.addEventListener('abort', abort, { once: true });
        try {
          await this.rpc.sendNotification('textDocument/didOpen', { textDocument: { uri, version: 1, text,
            languageId: /\.tsx$/i.test(file) ? 'typescriptreact' : /\.jsx$/i.test(file) ? 'javascriptreact' : /\.[cm]?ts$/i.test(file) ? 'typescript' : 'javascript' } });
          return await this.bounded(() => this.rpc.sendRequest('textDocument/definition', { textDocument: { uri }, position }, cancellation.token));
        } finally {
          signal?.removeEventListener('abort', abort);
          cancellation.dispose();
          if (!this.dead) await this.rpc.sendNotification('textDocument/didClose', { textDocument: { uri } });
        }
      } finally { this.scheduleIdle(); }
    };
    const result = this.queue.then(run);
    this.queue = result.catch(() => undefined);
    return result;
  }
  dispose() {
    if (this.dead) return;
    this.dead = true;
    liveSessions.delete(this);
    clearTimeout(this.idle);
    this.rpc.dispose();
    if (this.child.pid) {
      try { process.kill(process.platform === 'win32' ? this.child.pid : -this.child.pid, 'SIGTERM'); } catch { /* already exited */ }
    }
  }
}

/** One lazy TS/JS session per checkout, shared by every pane. */
export class ProjectLanguageService {
  private sessions = new Map<string, LanguageSession>();
  private disposed = false;
  private readonly exit = () => this.dispose();
  constructor() { process.once('exit', this.exit); }
  async definitions(binding: CorpusBinding, file: string, position: SourcePosition, sourceSha256: string, signal?: AbortSignal): Promise<SourceDefinitions> {
    if (this.disposed) throw new Error('Language service is stopped');
    signal?.throwIfAborted();
    if (!isRepositoryFilePath(file) || !supportsDefinitions(file)) throw new Error('Definitions are supported for TypeScript and JavaScript files');
    if (!position || !Number.isInteger(position.line) || position.line < 0 || !Number.isInteger(position.character) || position.character < 0) throw new Error('Invalid source position');
    const text = await corpusProvider(binding).readDocumentText(binding, file);
    if (createHash('sha256').update(text).digest('hex') !== sourceSha256) throw new Error('Source changed on disk. Reload the file before looking up definitions.');
    const line = text.split(/\r?\n/)[position.line];
    if (line === undefined || position.character > line.length) throw new Error('Source position is outside the file');
    const root = await realpath(binding.root);
    if (this.disposed) throw new Error('Language service is stopped');
    signal?.throwIfAborted();
    let session = this.sessions.get(root);
    if (!session || session.dead) { session = new LanguageSession(root); this.sessions.set(root, session); }
    const result = await session.lookup(file, text, position, signal);
    signal?.throwIfAborted();
    const locations: SourceLocation[] = [];
    let outsideRoot = 0;
    const seen = new Set<string>();
    for (const item of (Array.isArray(result) ? result : result ? [result] : []) as Array<{ uri?: string; targetUri?: string; range?: SourceLocation['range']; targetSelectionRange?: SourceLocation['range'] }>) {
      const uri = item.targetUri ?? item.uri;
      if (!uri?.startsWith('file:')) { outsideRoot++; continue; }
      const relative = path.relative(root, fileURLToPath(uri)).split(path.sep).join('/');
      if (!isRepositoryFilePath(relative)) { outsideRoot++; continue; }
      const location = { path: relative, range: item.targetSelectionRange ?? item.range };
      const key = JSON.stringify(location);
      if (!seen.has(key)) { seen.add(key); locations.push(location); }
    }
    return { locations, outsideRoot };
  }
  dispose() { this.disposed = true; for (const session of this.sessions.values()) session.dispose(); this.sessions.clear(); process.removeListener('exit', this.exit); }
}
