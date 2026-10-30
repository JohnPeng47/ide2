import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

/** `selectable` rows have a checkbox; `group` rows tick all selectable descendants at once. */
export interface TreeNode {
  id: string; label: string; detail?: string; meta?: string; badge?: ReactNode;
  selectable?: boolean; group?: boolean; disabled?: boolean; children?: TreeNode[];
}
const leaves = (node: TreeNode): TreeNode[] => [...(node.selectable ? [node] : []), ...(node.children ?? []).flatMap(leaves)];
function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  if (!query) return nodes;
  const q = query.toLowerCase();
  return nodes.flatMap(node => {
    if (`${node.label} ${node.detail ?? ''}`.toLowerCase().includes(q)) return [node];
    const children = filterTree(node.children ?? [], query);
    return children.length ? [{ ...node, children }] : [];
  });
}

/** Ancestors of ticked rows; with nothing ticked, a short root list starts expanded. */
function initiallyOpen(nodes: TreeNode[], checked: Set<string>) {
  const ids = new Set<string>();
  const visit = (node: TreeNode): boolean => {
    const inside = (node.children ?? []).map(visit).some(Boolean);
    if (inside) ids.add(node.id);
    return inside || checked.has(node.id);
  };
  nodes.forEach(visit);
  if (!ids.size && nodes.length <= 6) nodes.forEach(node => ids.add(node.id));
  return ids;
}

/** Checkbox tree for assembling run inputs. Ticked rows and their ancestors start expanded. */
export function SourceTree({ label, nodes, checked, onToggle, empty }: {
  label: string; nodes: TreeNode[]; checked: Set<string>; onToggle: (node: TreeNode, on: boolean) => void; empty?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string>>(() => initiallyOpen(nodes, checked));
  // Trees that mount before their data arrives reveal ticked rows once it does.
  const revealed = useRef(nodes.length > 0);
  useEffect(() => {
    if (revealed.current || !nodes.length) return;
    revealed.current = true; setOpen(initiallyOpen(nodes, checked));
  }, [nodes]);
  const visible = useMemo(() => filterTree(nodes, query.trim()), [nodes, query]);
  const toggleOpen = (id: string) => setOpen(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const row = (node: TreeNode, depth: number): ReactNode => {
    const children = node.children ?? [], expanded = !!query || open.has(node.id);
    const descendants = node.group ? leaves(node).filter(leaf => leaf !== node) : [];
    const tickedCount = descendants.filter(leaf => checked.has(leaf.id)).length;
    const groupState = node.group && descendants.length ? (tickedCount === descendants.length ? 'all' : tickedCount ? 'some' : 'none') : undefined;
    const box = node.selectable || groupState;
    const on = node.selectable ? checked.has(node.id) : groupState === 'all';
    return <li key={node.id} role="treeitem" aria-expanded={children.length ? expanded : undefined} aria-selected={node.selectable ? on : undefined} aria-level={depth + 1}>
      <div className={`source-tree-row${on ? ' is-checked' : ''}${node.disabled ? ' is-disabled' : ''}`} style={{ paddingLeft: 6 + depth * 16 }}>
        {children.length ? <button type="button" className="source-tree-chevron" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.label}`} onClick={() => toggleOpen(node.id)}>{expanded ? '▾' : '▸'}</button>
          : <span className="source-tree-chevron" aria-hidden />}
        <label>
          {box ? <input type="checkbox" checked={on} disabled={node.disabled}
            ref={element => { if (element) element.indeterminate = groupState === 'some'; }}
            onChange={event => onToggle(node, event.target.checked)} /> : <span className="source-tree-nobox" aria-hidden />}
          <span className="source-tree-text"><span className="source-tree-label" title={node.label}>{node.label}</span>
            {node.detail && <small className="source-tree-detail" title={node.detail}>{node.detail}</small>}</span>
        </label>
        {node.badge}
        {node.meta && <span className="source-tree-meta">{node.meta}</span>}
      </div>
      {children.length > 0 && expanded && <ul role="group">{children.map(child => row(child, depth + 1))}</ul>}
    </li>;
  };
  return <div className="source-tree">
    <input type="search" aria-label={`Filter ${label}`} placeholder="Filter…" value={query} onChange={event => setQuery(event.target.value)} />
    {visible.length ? <ul role="tree" aria-label={label} aria-multiselectable="true">{visible.map(node => row(node, 0))}</ul>
      : <p className="evals-muted source-tree-empty">{query ? 'Nothing matches.' : empty}</p>}
  </div>;
}
