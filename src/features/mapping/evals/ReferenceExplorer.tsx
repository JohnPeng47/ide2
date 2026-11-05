import { useMemo, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import type { CompareCandidate } from '../../../../domain/mapping/compare/comparePageSession';
import type { EvalReference, EvalReferenceGroup } from '../../../../domain/mapping/evals/evalReference';
import { diagramFolders, referenceGroupNodes, type DiagramFolder, type DiagramLeaf } from '../../../../domain/mapping/evals/referenceExplorer';
import { RenameField, TrashIcon } from './EvalsTree';
import type { MenuSection } from './PopoverMenu';

interface TreeNode {
  id: string; label: string; meta?: string; title?: string; current?: boolean;
  /** Initial state until the user toggles it. */
  open?: boolean; onOpen?: () => void;
  onContextMenu?: (at: { x: number; y: number }) => void;
  remove?: { label: string; title?: string; run: () => void };
  rename?: { value: string; save: (name?: string) => void };
  children?: TreeNode[];
}

function ExplorerTree({ label, className, storage, nodes, expandAll }: { label: string; className: string; storage: string; nodes: TreeNode[]; expandAll?: boolean }) {
  // Only explicit toggles are kept, so a folder that opens by default (e.g. holding the current diagram) stays as the user left it.
  const [toggled, setToggled] = useState<Record<string, boolean>>(() => { try { const stored = JSON.parse(localStorage.getItem(storage) ?? '{}'); return Array.isArray(stored) ? {} : stored; } catch { return {}; } });
  const toggle = (id: string, open: boolean) => setToggled(previous => {
    const next = { ...previous, [id]: open };
    localStorage.setItem(storage, JSON.stringify(next)); return next;
  });
  const row = (node: TreeNode, depth: number): ReactNode => {
    const children = node.children ?? [], branch = node.children !== undefined;
    const expanded = branch && (expandAll || (toggled[node.id] ?? !!node.open));
    const menu = (event: MouseEvent) => { if (node.onContextMenu) { event.preventDefault(); node.onContextMenu({ x: event.clientX, y: event.clientY }); } };
    const keys = (event: KeyboardEvent) => {
      if (node.onContextMenu && (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey)) {
        event.preventDefault(); const box = event.currentTarget.getBoundingClientRect(); node.onContextMenu({ x: box.left + 24, y: box.bottom });
      }
      if (branch && (event.key === 'ArrowRight' && !expanded || event.key === 'ArrowLeft' && expanded)) { event.preventDefault(); toggle(node.id, !expanded); }
    };
    return <li key={node.id} role="treeitem" aria-level={depth + 1} aria-expanded={branch ? expanded : undefined} aria-current={node.current ? 'page' : undefined}>
      <div className={`evals-tree-row${node.current ? ' is-current' : ''}`} style={{ paddingLeft: 4 + depth * 14 }} title={node.title} onContextMenu={menu}>
        {branch ? <button type="button" tabIndex={-1} className="evals-tree-chevron" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.label}`} onClick={() => toggle(node.id, !expanded)}>{expanded ? '▾' : '▸'}</button>
          : <span className="evals-tree-chevron" aria-hidden />}
        {node.rename ? <RenameField value={node.rename.value} label={`Rename ${node.label}`} onDone={node.rename.save} />
          : <button type="button" className="evals-tree-label" onClick={node.onOpen ?? (() => toggle(node.id, !expanded))} onKeyDown={keys} aria-haspopup={node.onContextMenu ? 'menu' : undefined}><span>{node.label}</span></button>}
        {node.meta && <span className="evals-tree-meta">{node.meta}</span>}
        {node.remove && <button type="button" className="evals-tree-delete" aria-label={node.remove.label} title={node.remove.title ?? node.remove.label} onClick={node.remove.run}><TrashIcon /></button>}
      </div>
      {expanded && <ul role="group">{children.map(child => row(child, depth + 1))}</ul>}
    </li>;
  };
  return <ul role="tree" aria-label={label} className={`evals-tree ${className}`}>{nodes.map(node => row(node, 0))}</ul>;
}

const lineCount = (ascii: string) => ascii.split('\n').length;

function ReferencesTab({ references, groups, current, onOpen, onArchive, onMove, onCreateGroup, onRenameGroup, onDeleteGroup, onMenu }: {
  references: EvalReference[]; groups: EvalReferenceGroup[]; current?: string;
  onOpen: (id: string) => void; onArchive: (reference: EvalReference) => void; onMove: (reference: EvalReference, groupId: string | null) => void;
  onCreateGroup: (name: string) => void; onRenameGroup: (group: EvalReferenceGroup, name: string) => void; onDeleteGroup: (group: EvalReferenceGroup, members: number) => void;
  onMenu: (menu: { label: string; at: { x: number; y: number }; sections: MenuSection[] }) => void;
}) {
  const [query, setQuery] = useState(''), [creating, setCreating] = useState(false), [renaming, setRenaming] = useState<string>();
  const nodes = useMemo(() => referenceGroupNodes(references, groups, query).map((node): TreeNode => {
    const group = node.group, members = node.references.length;
    return {
      id: node.id, label: node.name, meta: String(members), open: true,
      ...(group ? {
        remove: { label: `Delete group ${node.name}`, run: () => onDeleteGroup(group, members) },
        onContextMenu: at => onMenu({ label: node.name, at, sections: [{ label: node.name, items: [
          { label: 'Rename group', onSelect: () => setRenaming(group.id) },
          { label: 'Delete group…', danger: true, onSelect: () => onDeleteGroup(group, members) }] }] }),
        ...(renaming === group.id ? { rename: { value: node.name, save: (name?: string) => { setRenaming(undefined); if (name && name !== node.name) onRenameGroup(group, name); } } } : {})
      } : {}),
      children: node.references.map((reference): TreeNode => ({
        id: reference.id, label: reference.name, meta: `${lineCount(reference.ascii)} ln`, title: reference.ascii, current: reference.id === current, onOpen: () => onOpen(reference.id),
        remove: { label: `Archive reference ${reference.name}`, title: 'Archive (prompts that cite it keep working)', run: () => onArchive(reference) },
        onContextMenu: at => onMenu({ label: reference.name, at, sections: [
          { label: 'Move to group', items: [
            ...groups.filter(item => item.id !== reference.groupId).map(item => ({ label: item.name, onSelect: () => onMove(reference, item.id) })),
            ...(reference.groupId ? [{ label: 'Ungrouped', muted: true, onSelect: () => onMove(reference, null) }] : [])] },
          { items: [{ label: 'Archive', danger: true, onSelect: () => onArchive(reference) }] }] })
      }))
    };
  }), [references, groups, query, current, renaming, onOpen, onArchive, onMove, onRenameGroup, onDeleteGroup, onMenu]);
  return <>
    <div className="reference-list-tools">
      <input type="search" aria-label="Filter references" placeholder="Filter references…" value={query} onChange={event => setQuery(event.target.value)} />
      <button type="button" onClick={() => setCreating(true)}>+ Group</button>
    </div>
    {creating && <div className="reference-new-group"><RenameField value="" label="New group name" onDone={name => { setCreating(false); if (name) onCreateGroup(name); }} /></div>}
    {!nodes.length && !query ? <p className="evals-muted reference-empty">No references yet. Open the Canvas tab, select part of a diagram and promote it. Prompts can then cite it with <code>{'{{ref:…}}'}</code>.</p>
      : <ExplorerTree label="References" className="reference-groups" storage="reference-tree-toggled" nodes={nodes} expandAll={!!query} />}
    {!nodes.length && query && <p className="evals-muted reference-empty">No references match.</p>}
  </>;
}

function CanvasTab({ candidates, error, currentKey, onOpen }: { candidates?: CompareCandidate[]; error?: string; currentKey?: string; onOpen: (leaf: DiagramLeaf) => void }) {
  const [query, setQuery] = useState('');
  const nodes = useMemo(() => {
    const contains = (folder: DiagramFolder): boolean => folder.diagrams.some(leaf => leaf.key === currentKey) || folder.folders.some(contains);
    const node = (folder: DiagramFolder, depth: number): TreeNode => ({ id: folder.id, label: folder.name, meta: String(folder.count), open: depth === 0 || contains(folder), children: [
      ...folder.folders.map(child => node(child, depth + 1)),
      ...folder.diagrams.map((leaf): TreeNode => ({ id: leaf.key, label: leaf.name, title: leaf.name, current: leaf.key === currentKey, onOpen: () => onOpen(leaf) }))] });
    return diagramFolders(candidates ?? [], query).map(folder => node(folder, 0));
  }, [candidates, query, currentKey, onOpen]);
  return <>
    <div className="reference-list-tools">
      <input type="search" aria-label="Filter diagrams" placeholder="Filter diagrams…" value={query} onChange={event => setQuery(event.target.value)} />
    </div>
    {error ? <p role="alert" className="evals-error">{error}</p> : !candidates ? <p role="status" className="evals-muted reference-empty">Loading diagrams…</p>
      : nodes.length ? <ExplorerTree label="Diagrams" className="reference-diagrams" storage="reference-canvas-tree-toggled" nodes={nodes} expandAll={!!query} />
      : <p className="evals-muted reference-empty">{query ? 'No diagrams match.' : 'No saved diagrams yet.'}</p>}
  </>;
}

export type ReferenceExplorerTab = 'references' | 'canvas';
/** The explorer of the References area: saved references, and the diagrams new ones are captured from. */
export function ReferenceExplorer({ tab, onTab, onExit, references, groups, current, captureCount, candidates, candidatesError, currentDiagramKey, onOpenDiagram, ...actions }: {
  tab: ReferenceExplorerTab; onTab: (tab: ReferenceExplorerTab) => void; onExit: () => void; captureCount: number;
  candidates?: CompareCandidate[]; candidatesError?: string; currentDiagramKey?: string; onOpenDiagram: (leaf: DiagramLeaf) => void;
} & Parameters<typeof ReferencesTab>[0]) {
  return <div className="reference-explorer">
    <button type="button" className="evals-link reference-exit" onClick={onExit}>← Experiments</button>
    <div role="tablist" aria-label="References explorer" className="evals-tabs evals-nav-tabs">
      <button type="button" role="tab" aria-selected={tab === 'references'} onClick={() => onTab('references')}>References{references.length > 0 && <span className="evals-count">{references.length}</span>}</button>
      <button type="button" role="tab" aria-selected={tab === 'canvas'} onClick={() => onTab('canvas')}>Canvas{captureCount > 0 && <span className="evals-count">{captureCount}</span>}</button>
    </div>
    {tab === 'references' ? <ReferencesTab references={references} groups={groups} current={current} {...actions} />
      : <CanvasTab candidates={candidates} error={candidatesError} currentKey={currentDiagramKey} onOpen={onOpenDiagram} />}
  </div>;
}
