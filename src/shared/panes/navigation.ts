import { PaneApi } from "./api";

export interface PaneJumpDestination<Payload = unknown> {
  key: string;
  kind: string;
  paneId: string;
  tabId: string;
  label: string;
  detail?: string;
  payload: Payload;
}

export interface PaneJumpHistoryEntry<Payload = unknown> extends PaneJumpDestination<Payload> {
  jumpId: number;
  jumpedAt: number;
}

export type PaneJumpHandler = (destination: PaneJumpDestination) => void;
type Listener = () => void;
type Schedule = (callback: () => void) => void;

const DEFAULT_HISTORY_LIMIT = 3;

function afterPaneRender(callback: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(callback));
}

/**
 * Coordinates navigation across panes without coupling the pane layout to any
 * destination type. Feature views register handlers for their jump kind and
 * remain responsible for the final focus/scroll animation.
 */
export class PaneNavigationApi {
  private readonly listeners = new Set<Listener>();
  private readonly handlers = new Map<string, PaneJumpHandler>();
  private readonly pending = new Map<string, PaneJumpDestination>();
  private history: PaneJumpHistoryEntry[] = [];
  private nextJumpId = 1;

  constructor(
    private readonly panes: PaneApi,
    private readonly historyLimit = DEFAULT_HISTORY_LIMIT,
    private readonly schedule: Schedule = afterPaneRender
  ) {}

  getHistory = (): readonly PaneJumpHistoryEntry[] => this.history;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  registerHandler(kind: string, handler: PaneJumpHandler): () => void {
    this.handlers.set(kind, handler);
    const pending = this.pending.get(kind);
    if (pending) this.schedule(() => this.deliver(pending));
    return () => {
      if (this.handlers.get(kind) === handler) this.handlers.delete(kind);
    };
  }

  jump(destination: PaneJumpDestination, options: { record?: boolean } = {}): void {
    this.panes.activateTab(destination.paneId, destination.tabId);
    this.panes.focusPane(destination.paneId);
    if (options.record !== false && this.historyLimit > 0) {
      const entry: PaneJumpHistoryEntry = {
        ...destination,
        jumpId: this.nextJumpId,
        jumpedAt: Date.now()
      };
      this.nextJumpId += 1;
      this.history = [
        entry,
        ...this.history.filter((candidate) => candidate.key !== destination.key)
      ].slice(0, this.historyLimit);
      this.listeners.forEach((listener) => listener());
    }
    this.pending.set(destination.kind, destination);
    this.schedule(() => this.deliver(destination));
  }

  clearHistory(): void {
    if (this.history.length === 0) return;
    this.history = [];
    this.listeners.forEach((listener) => listener());
  }

  private deliver(destination: PaneJumpDestination): void {
    if (this.pending.get(destination.kind) !== destination) return;
    const handler = this.handlers.get(destination.kind);
    if (!handler) return;
    this.pending.delete(destination.kind);
    handler(destination);
  }
}
