/**
 * A presentation tree shared by every renderer (full-page overview, sidebar) and by ←/→ traversal.
 * `target` marks what selecting a node opens; other actions are renderer-specific.
 */
export interface ViewNode<T> {
  id: string;
  kind: 'section' | 'summary' | 'item' | 'comment';
  label: string;
  status?: string;
  counts?: { finished: number; total: number };
  detail?: string;
  /** Default display state only; never affects traversal. */
  collapsed?: boolean;
  target?: T;
  children?: ViewNode<T>[];
}

export interface NavigationStop<T> { key: string; target: T; path: string[]; label: string; index: number; prev?: string; next?: string }
/** A doubly linked list over one fixed order; prev(next(x)) === x for every stop. */
export interface NavigationList<T> { order: string[]; stops: Map<string, NavigationStop<T>> }

/**
 * Depth-first, in display order. The first occurrence of a target wins, so each target is one stop.
 * `crumb` decides which ancestors contribute to a stop's breadcrumb path.
 */
export function viewTreeOrder<T>(root: ViewNode<T>, key: (target: T) => string,
  { include = () => true, crumb = () => true }: { include?: (target: T) => boolean; crumb?: (node: ViewNode<T>) => boolean } = {}): NavigationList<T> {
  const order: string[] = [], stops = new Map<string, NavigationStop<T>>();
  const visit = (node: ViewNode<T>, path: string[]) => {
    if (node.target !== undefined && include(node.target)) {
      const id = key(node.target);
      if (!stops.has(id)) {
        const previous = order.at(-1);
        stops.set(id, { key: id, target: node.target, path, label: [...path, node.label].join(' · '), index: order.length, ...(previous ? { prev: previous } : {}) });
        if (previous) stops.get(previous)!.next = id;
        order.push(id);
      }
    }
    const childPath = node === root || node.target !== undefined || !crumb(node) ? path : [...path, node.label];
    node.children?.forEach(child => visit(child, childPath));
  };
  visit(root, []);
  return { order, stops };
}

/** Root-to-node chain for the first node matching `match`, or undefined. */
export function viewTreePath<T>(root: ViewNode<T>, match: (node: ViewNode<T>) => boolean): ViewNode<T>[] | undefined {
  if (match(root)) return [root];
  for (const child of root.children ?? []) {
    const path = viewTreePath(child, match);
    if (path) return [root, ...path];
  }
  return undefined;
}
