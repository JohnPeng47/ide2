export type PaneId = string;
export type PaneTabId = string;
export type PaneOrientation = "horizontal" | "vertical";
export type PanePlacement = "left" | "right" | "top" | "bottom";

export interface PaneTab {
  id: PaneTabId;
  label: string;
  badge?: string | number;
  closable?: boolean;
  domId?: string;
}

export interface Pane {
  id: PaneId;
  tabs: PaneTab[];
  activeTabId: PaneTabId | null;
  ariaLabel?: string;
  className?: string;
  tabListClassName?: string;
}

export interface PaneLeaf {
  kind: "pane";
  paneId: PaneId;
}

export interface PaneSplit {
  kind: "split";
  id: string;
  /** Horizontal places children left/right; vertical places them top/bottom. */
  orientation: PaneOrientation;
  ratio: number;
  first: PaneNode;
  second: PaneNode;
}

export type PaneNode = PaneLeaf | PaneSplit;

export interface PaneLayoutState {
  root: PaneNode | null;
  panes: Record<PaneId, Pane>;
  focusedPaneId: PaneId | null;
}

export interface CreatePaneInput extends Omit<Pane, "activeTabId"> {
  activeTabId?: PaneTabId | null;
}

export interface SplitPaneOptions {
  placement?: PanePlacement;
  ratio?: number;
  splitId?: string;
}

const MIN_RATIO = 0.1;
const MAX_RATIO = 0.9;
let nextGeneratedId = 1;

function generatedId(prefix: string): string {
  const id = `${prefix}-${nextGeneratedId}`;
  nextGeneratedId += 1;
  return id;
}

export function clampPaneRatio(ratio: number): number {
  return Math.max(MIN_RATIO, Math.min(MAX_RATIO, ratio));
}

function uniqueTabs(tabs: PaneTab[]): PaneTab[] {
  const seen = new Set<string>();
  return tabs.filter((tab) => {
    if (seen.has(tab.id)) return false;
    seen.add(tab.id);
    return true;
  });
}

export function definePane(input: CreatePaneInput): Pane {
  const tabs = uniqueTabs(input.tabs);
  const requestedActive = input.activeTabId ?? tabs[0]?.id ?? null;
  return {
    ...input,
    tabs,
    activeTabId: tabs.some((tab) => tab.id === requestedActive)
      ? requestedActive
      : tabs[0]?.id ?? null
  };
}

export function emptyPaneLayout(): PaneLayoutState {
  return { root: null, panes: {}, focusedPaneId: null };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Parse persisted layout state without trusting local-storage input. */
export function parsePaneLayout(serialized: string | null): PaneLayoutState | null {
  if (!serialized) return null;
  try {
    const value: unknown = JSON.parse(serialized);
    if (!isObject(value) || !isObject(value.panes)) return null;
    const panes: Record<string, Pane> = {};
    for (const [id, candidate] of Object.entries(value.panes)) {
      if (!isObject(candidate) || candidate.id !== id || !Array.isArray(candidate.tabs)) return null;
      const tabs: PaneTab[] = [];
      for (const tab of candidate.tabs) {
        if (!isObject(tab) || typeof tab.id !== "string" || typeof tab.label !== "string") return null;
        tabs.push(tab as unknown as PaneTab);
      }
      panes[id] = definePane({
        ...(candidate as unknown as CreatePaneInput),
        id,
        tabs,
        activeTabId: typeof candidate.activeTabId === "string" ? candidate.activeTabId : null
      });
    }

    const parseNode = (candidate: unknown): PaneNode | null | undefined => {
      if (candidate === null) return null;
      if (!isObject(candidate)) return undefined;
      if (candidate.kind === "pane" && typeof candidate.paneId === "string" && panes[candidate.paneId]) {
        return { kind: "pane", paneId: candidate.paneId };
      }
      if (candidate.kind !== "split"
        || typeof candidate.id !== "string"
        || (candidate.orientation !== "horizontal" && candidate.orientation !== "vertical")
        || typeof candidate.ratio !== "number"
        || !Number.isFinite(candidate.ratio)) return undefined;
      const first = parseNode(candidate.first);
      const second = parseNode(candidate.second);
      if (!first || !second) return undefined;
      return {
        kind: "split",
        id: candidate.id,
        orientation: candidate.orientation,
        ratio: clampPaneRatio(candidate.ratio),
        first,
        second
      };
    };
    const root = parseNode(value.root);
    if (root === undefined) return null;
    const ids = paneIds(root);
    if (new Set(ids).size !== ids.length || ids.some((id) => !panes[id])) return null;
    if (Object.keys(panes).some((id) => !ids.includes(id))) return null;
    const focusedPaneId = typeof value.focusedPaneId === "string" && panes[value.focusedPaneId]
      ? value.focusedPaneId
      : ids[0] ?? null;
    return { root, panes, focusedPaneId };
  } catch {
    return null;
  }
}

export function createPaneLayout(rootPane: CreatePaneInput): PaneLayoutState {
  const pane = definePane(rootPane);
  return {
    root: { kind: "pane", paneId: pane.id },
    panes: { [pane.id]: pane },
    focusedPaneId: pane.id
  };
}

export function paneIds(node: PaneNode | null): PaneId[] {
  if (!node) return [];
  return node.kind === "pane"
    ? [node.paneId]
    : [...paneIds(node.first), ...paneIds(node.second)];
}

function replacePaneNode(node: PaneNode, paneId: PaneId, replacement: PaneNode): PaneNode {
  if (node.kind === "pane") return node.paneId === paneId ? replacement : node;
  const first = replacePaneNode(node.first, paneId, replacement);
  const second = replacePaneNode(node.second, paneId, replacement);
  return first === node.first && second === node.second ? node : { ...node, first, second };
}

function removePaneNode(node: PaneNode, paneId: PaneId): PaneNode | null {
  if (node.kind === "pane") return node.paneId === paneId ? null : node;
  const first = removePaneNode(node.first, paneId);
  const second = removePaneNode(node.second, paneId);
  if (!first) return second;
  if (!second) return first;
  return first === node.first && second === node.second ? node : { ...node, first, second };
}

function replaceSplit(node: PaneNode, splitId: string, ratio: number): PaneNode {
  if (node.kind === "pane") return node;
  if (node.id === splitId) return { ...node, ratio: clampPaneRatio(ratio) };
  const first = replaceSplit(node.first, splitId, ratio);
  const second = replaceSplit(node.second, splitId, ratio);
  return first === node.first && second === node.second ? node : { ...node, first, second };
}

function tabExistsOutsidePane(state: PaneLayoutState, paneId: PaneId, tabId: PaneTabId): boolean {
  return Object.values(state.panes).some((pane) => (
    pane.id !== paneId && pane.tabs.some((tab) => tab.id === tabId)
  ));
}

export function addPane(
  state: PaneLayoutState,
  paneInput: CreatePaneInput,
  targetPaneId?: PaneId,
  options: SplitPaneOptions = {}
): PaneLayoutState {
  if (state.panes[paneInput.id]) throw new Error(`pane already exists: ${paneInput.id}`);
  const pane = definePane(paneInput);
  for (const tab of pane.tabs) {
    if (Object.values(state.panes).some((candidate) => candidate.tabs.some(({ id }) => id === tab.id))) {
      throw new Error(`tab already exists: ${tab.id}`);
    }
  }
  if (!state.root) {
    return {
      root: { kind: "pane", paneId: pane.id },
      panes: { [pane.id]: pane },
      focusedPaneId: pane.id
    };
  }

  const target = targetPaneId ?? state.focusedPaneId;
  if (!target || !state.panes[target]) throw new Error(`target pane does not exist: ${target ?? "none"}`);
  const placement = options.placement ?? "right";
  const newLeaf: PaneLeaf = { kind: "pane", paneId: pane.id };
  const targetLeaf: PaneLeaf = { kind: "pane", paneId: target };
  const newPaneFirst = placement === "left" || placement === "top";
  const split: PaneSplit = {
    kind: "split",
    id: options.splitId ?? generatedId("split"),
    orientation: placement === "left" || placement === "right" ? "horizontal" : "vertical",
    ratio: clampPaneRatio(options.ratio ?? 0.5),
    first: newPaneFirst ? newLeaf : targetLeaf,
    second: newPaneFirst ? targetLeaf : newLeaf
  };
  return {
    root: replacePaneNode(state.root, target, split),
    panes: { ...state.panes, [pane.id]: pane },
    focusedPaneId: pane.id
  };
}

export function removePane(state: PaneLayoutState, paneId: PaneId): PaneLayoutState {
  if (!state.panes[paneId] || !state.root) return state;
  const root = removePaneNode(state.root, paneId);
  const panes = { ...state.panes };
  delete panes[paneId];
  const remainingIds = paneIds(root);
  return {
    root,
    panes,
    focusedPaneId: state.focusedPaneId === paneId
      ? remainingIds[0] ?? null
      : state.focusedPaneId
  };
}

export function focusPane(state: PaneLayoutState, paneId: PaneId): PaneLayoutState {
  return state.panes[paneId] && state.focusedPaneId !== paneId
    ? { ...state, focusedPaneId: paneId }
    : state;
}

export function activatePaneTab(
  state: PaneLayoutState,
  paneId: PaneId,
  tabId: PaneTabId
): PaneLayoutState {
  const pane = state.panes[paneId];
  if (!pane?.tabs.some((tab) => tab.id === tabId)) return state;
  if (pane.activeTabId === tabId && state.focusedPaneId === paneId) return state;
  return {
    ...state,
    panes: pane.activeTabId === tabId
      ? state.panes
      : { ...state.panes, [paneId]: { ...pane, activeTabId: tabId } },
    focusedPaneId: paneId
  };
}

export function setPaneTabs(
  state: PaneLayoutState,
  paneId: PaneId,
  tabs: PaneTab[],
  activeTabId?: PaneTabId | null
): PaneLayoutState {
  const pane = state.panes[paneId];
  if (!pane) return state;
  const nextTabs = uniqueTabs(tabs);
  for (const tab of nextTabs) {
    if (tabExistsOutsidePane(state, paneId, tab.id)) throw new Error(`tab already exists: ${tab.id}`);
  }
  const requestedActive = activeTabId === undefined ? pane.activeTabId : activeTabId;
  const nextActive = nextTabs.some((tab) => tab.id === requestedActive)
    ? requestedActive
    : nextTabs[0]?.id ?? null;
  if (JSON.stringify(pane.tabs) === JSON.stringify(nextTabs) && pane.activeTabId === nextActive) return state;
  return {
    ...state,
    panes: { ...state.panes, [paneId]: { ...pane, tabs: nextTabs, activeTabId: nextActive } }
  };
}

export function addPaneTab(state: PaneLayoutState, paneId: PaneId, tab: PaneTab): PaneLayoutState {
  const pane = state.panes[paneId];
  if (!pane) throw new Error(`pane does not exist: ${paneId}`);
  if (Object.values(state.panes).some((candidate) => candidate.tabs.some(({ id }) => id === tab.id))) {
    throw new Error(`tab already exists: ${tab.id}`);
  }
  return {
    ...state,
    panes: {
      ...state.panes,
      [paneId]: { ...pane, tabs: [...pane.tabs, tab], activeTabId: tab.id }
    },
    focusedPaneId: paneId
  };
}

export function closePaneTab(state: PaneLayoutState, paneId: PaneId, tabId: PaneTabId): PaneLayoutState {
  const pane = state.panes[paneId];
  const index = pane?.tabs.findIndex((tab) => tab.id === tabId) ?? -1;
  if (!pane || index < 0) return state;
  if (pane.tabs.length === 1) return removePane(state, paneId);
  const tabs = pane.tabs.filter((tab) => tab.id !== tabId);
  const activeTabId = pane.activeTabId === tabId
    ? tabs[Math.min(index, tabs.length - 1)].id
    : pane.activeTabId;
  return {
    ...state,
    panes: { ...state.panes, [paneId]: { ...pane, tabs, activeTabId } }
  };
}

export function movePaneTab(
  state: PaneLayoutState,
  tabId: PaneTabId,
  targetPaneId: PaneId,
  targetIndex?: number
): PaneLayoutState {
  const source = Object.values(state.panes).find((pane) => pane.tabs.some((tab) => tab.id === tabId));
  const target = state.panes[targetPaneId];
  if (!source || !target) return state;
  if (source.id === target.id) {
    const from = source.tabs.findIndex((tab) => tab.id === tabId);
    const to = Math.max(0, Math.min(targetIndex ?? source.tabs.length - 1, source.tabs.length - 1));
    if (from === to) return state;
    const tabs = [...source.tabs];
    const [tab] = tabs.splice(from, 1);
    tabs.splice(to, 0, tab);
    return { ...state, panes: { ...state.panes, [source.id]: { ...source, tabs } } };
  }

  const tab = source.tabs.find((candidate) => candidate.id === tabId)!;
  const sourceTabs = source.tabs.filter((candidate) => candidate.id !== tabId);
  const insertAt = Math.max(0, Math.min(targetIndex ?? target.tabs.length, target.tabs.length));
  const targetTabs = [...target.tabs];
  targetTabs.splice(insertAt, 0, tab);
  let next: PaneLayoutState = {
    ...state,
    panes: {
      ...state.panes,
      [source.id]: {
        ...source,
        tabs: sourceTabs,
        activeTabId: source.activeTabId === tabId ? sourceTabs[0]?.id ?? null : source.activeTabId
      },
      [target.id]: { ...target, tabs: targetTabs, activeTabId: tabId }
    },
    focusedPaneId: target.id
  };
  if (sourceTabs.length === 0) next = removePane(next, source.id);
  return next;
}

export function resizePaneSplit(state: PaneLayoutState, splitId: string, ratio: number): PaneLayoutState {
  if (!state.root) return state;
  const root = replaceSplit(state.root, splitId, ratio);
  return root === state.root ? state : { ...state, root };
}

export function findPaneSplit(node: PaneNode | null, splitId: string): PaneSplit | null {
  if (!node || node.kind === "pane") return null;
  if (node.id === splitId) return node;
  return findPaneSplit(node.first, splitId) ?? findPaneSplit(node.second, splitId);
}
