import type { CanvasCommand, CanvasDescriptor } from '../../../domain/mapping/agent/contracts';
export interface CanvasSessionPort {
  register(descriptor: CanvasDescriptor): void;
  list(): CanvasDescriptor[];
  poll(canvasId: string): Promise<CanvasCommand[]>;
  reply(canvasId: string, commandId: string, result: { value?: unknown; error?: string }): void;
  dispatch(canvasId: string, command: Omit<CanvasCommand, 'id'>): Promise<unknown>;
  unregister(canvasId: string): void;
  dispose(): void;
}
export interface AgentExecRuntime { run(code: string, invoke: (method: string, args: unknown) => Promise<unknown>): Promise<unknown> }
