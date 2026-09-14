import {
  activatePaneTab,
  addPane,
  addPaneTab,
  closePaneTab,
  focusPane,
  movePaneTab,
  removePane,
  resizePaneSplit,
  setPaneTabs,
  type CreatePaneInput,
  type PaneLayoutState,
  type PaneTab,
  type SplitPaneOptions
} from "./model";

type Listener = () => void;

/** Command surface used by application features without coupling them to the renderer. */
export class PaneApi {
  private state: PaneLayoutState;
  private readonly listeners = new Set<Listener>();

  constructor(initialState: PaneLayoutState) {
    this.state = initialState;
  }

  getState = (): PaneLayoutState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private commit(next: PaneLayoutState): void {
    if (next === this.state) return;
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }

  createPane(pane: CreatePaneInput, targetPaneId?: string, options?: SplitPaneOptions): void {
    this.commit(addPane(this.state, pane, targetPaneId, options));
  }

  closePane(paneId: string): void {
    this.commit(removePane(this.state, paneId));
  }

  focusPane(paneId: string): void {
    this.commit(focusPane(this.state, paneId));
  }

  activateTab(paneId: string, tabId: string): void {
    this.commit(activatePaneTab(this.state, paneId, tabId));
  }

  setTabs(paneId: string, tabs: PaneTab[], activeTabId?: string | null): void {
    this.commit(setPaneTabs(this.state, paneId, tabs, activeTabId));
  }

  addTab(paneId: string, tab: PaneTab): void {
    this.commit(addPaneTab(this.state, paneId, tab));
  }

  closeTab(paneId: string, tabId: string): void {
    this.commit(closePaneTab(this.state, paneId, tabId));
  }

  moveTab(tabId: string, targetPaneId: string, targetIndex?: number): void {
    this.commit(movePaneTab(this.state, tabId, targetPaneId, targetIndex));
  }

  resizeSplit(splitId: string, ratio: number): void {
    this.commit(resizePaneSplit(this.state, splitId, ratio));
  }
}
