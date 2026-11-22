import { useEffect, useMemo, useRef, useState } from 'react';
import { viewTreePath, type ViewNode } from '../../../../domain/core/presentation/viewTree';

/**
 * Compact sidebar renderer for any ViewTree. Only branches leading to a target are shown, and only targets
 * are selectable; comments and secondary actions belong to the full-page renderer. The current node's ancestors are always expanded.
 */
export function ViewTreeSidebar<T>({ root, keyOf, currentKey, selectable = () => true, onOpen, labelOf = node => node.label, flatten = () => false }: {
  root: ViewNode<T>; keyOf: (target: T) => string; currentKey?: string;
  selectable?: (target: T) => boolean; onOpen: (target: T) => void;
  /** Sidebar-specific names, e.g. an item's own title where tree labels repeat. */
  labelOf?: (node: ViewNode<T>) => string;
  /** Grouping nodes whose children are shown in their place. */
  flatten?: (node: ViewNode<T>) => boolean;
}) {
  const ancestors = useMemo(() => new Set((currentKey ? viewTreePath(root, node => node.target !== undefined && keyOf(node.target) === currentKey) : undefined)
    ?.slice(0, -1).map(node => node.id) ?? []), [root, currentKey, keyOf]);
  const [toggled, setToggled] = useState<Map<string, boolean>>(new Map());
  // Navigating to another stop re-opens its ancestors, even if the user collapsed them earlier.
  useEffect(() => setToggled(previous => { const next = new Map(previous); ancestors.forEach(id => next.delete(id)); return next; }), [ancestors]);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => { list.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' }); }, [currentKey, root]);
  const open = (node: ViewNode<T>) => toggled.get(node.id) ?? (ancestors.has(node.id) || !node.collapsed);

  // The sidebar shows only the navigable skeleton: branches that lead to at least one target.
  const leads = useMemo(() => {
    const result = new Set<string>();
    const visit = (node: ViewNode<T>): boolean => {
      const found = (node.children ?? []).map(visit).some(Boolean) || node.target !== undefined;
      if (found) result.add(node.id);
      return found;
    };
    visit(root);
    return result;
  }, [root]);
  const visible = (nodes: ViewNode<T>[] = []): ViewNode<T>[] => nodes.filter(node => leads.has(node.id)).flatMap(node => flatten(node) ? visible(node.children) : [node]);
  const row = (node: ViewNode<T>, depth: number): React.ReactNode => {
    if (!leads.has(node.id)) return null;
    const children = visible(node.children);
    const expanded = open(node), target = node.target, label = labelOf(node);
    const current = target !== undefined && keyOf(target) === currentKey;
    const enabled = target !== undefined && selectable(target);
    return <li key={node.id}>
      <div className={`view-tree-row is-${node.kind}${current ? ' is-current' : ''}${target !== undefined && !enabled ? ' is-disabled' : ''}`}
        style={{ paddingLeft: `${depth * 12 + 4}px` }} aria-current={current ? 'true' : undefined}>
        {children.length ? <button type="button" className="view-tree-toggle" aria-expanded={expanded} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.label}`}
          onClick={() => setToggled(previous => new Map(previous).set(node.id, !expanded))}>{expanded ? '▾' : '▸'}</button> : <span className="view-tree-toggle" />}
        {enabled ? <button type="button" className="view-tree-label is-target" title={label} onClick={() => onOpen(target!)}>{label}</button>
          : <span className="view-tree-label" title={label}>{label}</span>}
        {node.counts ? <small>{node.counts.finished}/{node.counts.total}</small>
          : node.status && node.status !== 'finished' ? <small className="view-tree-status" data-status={node.status}>{node.status}</small> : null}
      </div>
      {expanded && children.length > 0 && <ul>{children.map(child => row(child, depth + 1))}</ul>}
    </li>;
  };
  return <ul ref={list} className="view-tree" aria-label={root.label}>{visible(root.children).map(child => row(child, 0))}</ul>;
}
