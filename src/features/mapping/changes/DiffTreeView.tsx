import { useEffect, useMemo, useRef } from 'react';
import { DiagramText, JumpChoices } from '../../../shared/diagrams/DiagramText';
import { diagramTextRanges, textRow } from '../../../../domain/core/diagrams/diagramText';
import { visibleContentLines } from '../../../../domain/core/diagrams/diagramContent';
import { usePanelScroll } from '../window-panel/windowPanelState';
import type { DiffTreeRead } from './changeSessionApi';
import type { DiagramJumpTarget } from '../../../../domain/core/diagrams/diagramJump';
import { coverageLabel, coverageTitle, type DiffCoverage } from './diffTreeCoverage';
export function DiffTreeView({ tree, selected, tracked, coverage, onJump, collapsed, onSelect, onCollapse, storageKey }: {
  tree: NonNullable<DiffTreeRead['diffTree']>; tracked?: string; coverage: DiffCoverage; onJump: (target: DiagramJumpTarget) => void; selected: string; collapsed: string[]; onSelect: (id: string, activate?: boolean) => void;
  onCollapse: (ids: string[]) => void; storageKey: string;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  usePanelScroll(scroll, storageKey + ':tree-scroll', true);
  const current = tree.nodes.find(node => node.id === selected);
  const mapped = new Set(tree.mappings.map(mapping => mapping.nodeId));
  const { rows, visible } = useMemo(() => {
    const content = tree.diagram.content;
    const raw = content.structure.kind === 'tree' ? Object.values(content.structure.nodes) : [];
    const byLine = new Map(tree.nodes.map(node => [node.line, node]));
    const rawCollapsed = raw.filter(node => collapsed.includes(byLine.get(node.line)?.id ?? '')).map(node => node.id);
    const lines = visibleContentLines(content, rawCollapsed), ascii = content.ascii.split('\n');
    const ranges = diagramTextRanges({ ascii: content.ascii, content, displayNodeId: tree.diagram.diagramId });
    return { rows: lines.map(line => textRow(ascii[line - 1], (ranges.get(line) ?? []).map(range => ({ ...range,
      owner: range.owner?.contentNodeId ? { ...range.owner, contentNodeId: byLine.get(line)?.id } : range.owner })), line)),
      visible: tree.nodes.filter(node => lines.includes(node.line)) };
  }, [tree, collapsed]);
  useEffect(() => {
    if (!tracked) return;
    let node = tree.nodes.find(node => node.id === tracked);
    const ancestors: string[] = [];
    while (node?.parentId) { ancestors.push(node.parentId); node = tree.nodes.find(n => n.id === node!.parentId); }
    if (collapsed.some(id => ancestors.includes(id))) { onCollapse(collapsed.filter(id => !ancestors.includes(id))); return; }
    const element = scroll.current?.querySelector<HTMLElement>(`[data-content-node-id="${tracked}"]`);
    if (element && scroll.current) {
      const container = scroll.current; container.dataset.programmaticScroll = 'true';
      const bounds = container.getBoundingClientRect(), rect = element.getBoundingClientRect();
      if (rect.top < bounds.top || rect.bottom > bounds.bottom) container.scrollTop += rect.top - bounds.top - bounds.height / 2;
      const timer = setTimeout(() => { delete container.dataset.programmaticScroll; }, 150);
      return () => clearTimeout(timer);
    }
  }, [tracked, tree, collapsed, onCollapse]);
  const toggle = (id: string) => onCollapse(collapsed.includes(id) ? collapsed.filter(value => value !== id) : [...collapsed, id]);
  const focus = (id: string) => { onSelect(id, false); requestAnimationFrame(() => scroll.current?.querySelector<HTMLElement>(`[data-content-node-id="${id}"]`)?.focus()); };
  return <>
    <div className="diff-pane-toolbar"><button aria-pressed={selected === '*'} onClick={() => onSelect('*')}>All changes</button>
      <button disabled={!current?.childIds.length} onClick={() => current && toggle(current.id)}>{collapsed.includes(selected) ? 'Expand selected' : 'Collapse selected'}</button></div>
    <div ref={scroll} className="diff-tree-scroll"><DiagramText className="diff-tree-ascii" role="tree" aria-label="ChangeSession diff tree" rows={rows}
      nodeSuffix={owner => {
        const id = owner.contentNodeId!; const stats = coverage.stats(coverage.hunksFor(id));
        const node = tree.nodes.find(node => node.id === id)!;
        const targets = coverage.targetsFor(id);
        const jumps = targets.map((target, index) => ({ id: `${id}:${index}`, target, source: { revisionId: tree.diagram.content.revisionId, contentHash: tree.diagram.content.asciiSha256, line: node.line, startColumn: node.startColumn, endColumn: node.endColumn } }));
        return <><span className="diff-coverage" title={coverageTitle(stats)}>{coverageLabel(stats)}</span>
          {!!jumps.length && <JumpChoices text="↗" run={{ text: '↗', start: 0, end: 1, mappings: [], jump: jumps[0], jumps }} onJump={onJump} />}</>;
      }}
      nodeProps={owner => {
        const node = tree.nodes.find(node => node.id === owner.contentNodeId); if (!node) return;
        let level = 1, parent = node.parentId;
        while (parent) { level++; parent = tree.nodes.find(n => n.id === parent)?.parentId; }
        return { role: 'treeitem', tabIndex: node.id === selected || !visible.some(n => n.id === selected) && node === visible[0] ? 0 : -1,
          'aria-label': node.label, 'aria-level': level, 'aria-selected': node.id === selected,
          'aria-expanded': node.childIds.length ? !collapsed.includes(node.id) : undefined,
          ...{ 'data-mapped': mapped.has(node.id), 'data-scroll-tracked': node.id === tracked },
          onClick: () => onSelect(node.id), onDoubleClick: () => node.childIds.length && toggle(node.id),
          onKeyDown: event => {
            const index = visible.findIndex(n => n.id === node.id);
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
              event.preventDefault(); const next = event.key === 'Home' ? visible[0] : event.key === 'End' ? visible.at(-1) : visible[index + (event.key === 'ArrowDown' ? 1 : -1)]; if (next) focus(next.id);
            } else if (event.key === 'ArrowLeft') { event.preventDefault(); if (node.childIds.length && !collapsed.includes(node.id)) toggle(node.id); else if (node.parentId) focus(node.parentId); }
            else if (event.key === 'ArrowRight') { event.preventDefault(); if (collapsed.includes(node.id)) toggle(node.id); else if (node.childIds[0]) focus(node.childIds[0]); }
            else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(node.id); }
          }
        };
      }} /></div>
  </>;
}
