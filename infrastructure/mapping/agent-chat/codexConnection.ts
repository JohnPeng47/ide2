import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { requireAiEnabled } from '../../../application/core/errors';
import type { CodexConnection, CodexMessage } from '../../../application/mapping/agent-chat/ports';

/** T3 Code's stdio app-server lifecycle, adapted to this app's service boundary. */
export class StdioCodexConnection implements CodexConnection {
  private child?: ChildProcessWithoutNullStreams;
  private starting?: Promise<void>;
  private serial = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private listeners = new Set<{ message: (message: CodexMessage) => void; exit: (error: string) => void }>();
  constructor(private cwd: string, private enabled: boolean, private command = process.env.NEW_DIAGRAM_CODEX_BIN || 'codex') {}
  subscribe(message: (message: CodexMessage) => void, exit: (error: string) => void) {
    const entry = { message, exit }; this.listeners.add(entry); return () => { this.listeners.delete(entry); };
  }
  private start() {
    requireAiEnabled(this.enabled);
    if (this.starting) return this.starting;
    const child = spawn(this.command, ['app-server', '--listen', 'stdio://'], { cwd: this.cwd, stdio: 'pipe' });
    this.child = child;
    // Drain stderr without exposing local configuration or credentials to the browser.
    child.stderr.resume();
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      let message: { id?: number | string; method?: string; params?: Record<string, unknown>; error?: { message: string }; result?: unknown };
      try { message = JSON.parse(line); } catch { return; }
      if (message.method) {
        for (const listener of this.listeners) listener.message({ method: message.method, params: message.params ?? {}, id: message.id });
      } else if (typeof message.id === 'number') {
        const pending = this.pending.get(message.id); if (!pending) return;
        clearTimeout(pending.timer); this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result);
      }
    });
    const failed = (message: string) => {
      if (this.child !== child) return;
      this.child = undefined; this.starting = undefined; lines.close();
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(message)); }
      this.pending.clear();
      for (const listener of this.listeners) listener.exit(message);
    };
    child.once('error', error => failed(`Cannot start Codex: ${error.message}. Install Codex and run codex login on the server.`));
    child.once('exit', () => failed('Codex disconnected. Send another message to resume the conversation.'));
    child.stdin.on('error', () => failed('Codex input disconnected.'));
    this.starting = this.rpc('initialize', { clientInfo: { name: 'new_diagram', title: 'New Diagram', version: '0.1.0' }, capabilities: { experimentalApi: true } })
      .then(() => { this.write({ method: 'initialized' }); }).catch(error => { child.kill(); failed(String(error)); throw error; });
    return this.starting;
  }
  private write(message: unknown) {
    if (!this.child?.stdin.writable) throw new Error('Codex is disconnected.');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }
  private rpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex ${method} timed out.`)); }, 30_000);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      try { this.write({ id, method, params }); } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  async request<T>(method: string, params: Record<string, unknown>): Promise<T> { await this.start(); return this.rpc<T>(method, params); }
  respond(id: string | number, result: unknown) { this.write({ id, result }); }
  reject(id: string | number, message: string) { this.write({ id, error: { code: -32601, message } }); }
  dispose() { this.child?.kill(); }
}
