import { randomUUID } from 'node:crypto';
import type { CanvasSessionPort } from '../../../application/mapping/agent/ports';
import type { CanvasCommand, CanvasDescriptor } from '../../../domain/mapping/agent/contracts';
export class CanvasSessionBridge implements CanvasSessionPort {
  private canvases = new Map<string, { descriptor: CanvasDescriptor; touched: number; commands: CanvasCommand[]; wake?: () => void }>();
  private pending = new Map<string, { canvasId: string; resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  register(descriptor: CanvasDescriptor) {
    const old = this.canvases.get(descriptor.canvasId);
    if (old) { old.descriptor = structuredClone(descriptor); old.touched = Date.now(); }
    else this.canvases.set(descriptor.canvasId, { descriptor: structuredClone(descriptor), touched: Date.now(), commands: [] });
  }
  list() {
    for (const [id, entry] of this.canvases) if (Date.now() - entry.touched > 35000) this.unregister(id);
    return [...this.canvases.values()].map(entry => structuredClone(entry.descriptor));
  }
  async poll(canvasId: string) {
    const entry = this.canvases.get(canvasId);
    if (!entry) throw new Error('CANVAS_UNAVAILABLE');
    entry.touched = Date.now();
    if (!entry.commands.length) await new Promise<void>(resolve => {
      entry.wake?.();
      const timer = setTimeout(done, 15000);
      function done() { clearTimeout(timer); if (entry!.wake === done) entry!.wake = undefined; resolve(); }
      entry.wake = done;
    });
    entry.touched = Date.now();
    return entry.commands.splice(0);
  }
  dispatch(canvasId: string, command: Omit<CanvasCommand, 'id'>): Promise<unknown> {
    this.list();
    const entry = this.canvases.get(canvasId);
    if (!entry) return Promise.reject(new Error('CANVAS_UNAVAILABLE: open Mapping and attach again'));
    if (this.pending.size >= 100) return Promise.reject(new Error('Too many pending canvas commands'));
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id); entry.commands = entry.commands.filter(command => command.id !== id);
        reject(new Error('CANVAS_TIMEOUT: outcome may be unknown; retry with the same requestId'));
      }, 25000);
      this.pending.set(id, { canvasId, resolve, reject, timer });
      entry.commands.push({ ...command, id }); entry.wake?.();
    });
  }
  reply(canvasId: string, commandId: string, result: { value?: unknown; error?: string }) {
    const pending = this.pending.get(commandId);
    if (!pending || pending.canvasId !== canvasId) return;
    clearTimeout(pending.timer); this.pending.delete(commandId);
    if (result.error) pending.reject(new Error(result.error)); else pending.resolve(result.value);
  }
  unregister(canvasId: string) {
    this.canvases.get(canvasId)?.wake?.(); this.canvases.delete(canvasId);
    for (const [id, pending] of this.pending) if (pending.canvasId === canvasId) {
      clearTimeout(pending.timer); pending.reject(new Error('CANVAS_UNAVAILABLE')); this.pending.delete(id);
    }
  }
  dispose() { [...this.canvases.keys()].forEach(id => this.unregister(id)); }
}
