import { repositoryGroups, type Repository } from '../../../../domain/core/repositories/repository';
import { RepositoryTreeGroup } from './RepositoryTreeGroup';
import { ChangeSessionExplorer } from '../changes/ChangeSessionExplorer';
import type { DisplayModeChange } from '../changes/changeSessionApi';
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ProjectRepresentationRecord } from "../../../../domain/core/representations/projectCatalog";
export function MappingDiagramExplorer(props: {
  transfer?: { mode: 'copy' | 'move'; count: number; sourceId: string; busy: boolean; error?: string; progress?: string; onCancel: () => void; onNew: (name: string) => void };
  explorerTab: 'diagrams'|'changes'|'canvas'; onTabChange: (tab: 'diagrams'|'changes'|'canvas') => void;
  canvas?: ReactNode;
  changeMode?: DisplayModeChange; onChangeSelect: (mode: DisplayModeChange) => void;
  repositories?: Repository[]; projectName: string; diagrams: (Pick<ProjectRepresentationRecord, 'id' | 'name' | 'repositoryId'> & { parentCanvasId?: string })[]; activeId?: string;
  dirtyIds: string[]; onOpen: (id: string) => void;
  onDelete: (id: string) => void; deletingId?: string; deleteDisabled: boolean; busyIds: string[];
}) {
  const [query, setQuery] = useState("");
  const [newCanvas, setNewCanvas] = useState(false);
  const [name, setName] = useState('New canvas');
  const picker = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setNewCanvas(false); setName('New canvas');
    if (props.transfer) { setQuery(''); picker.current?.focus(); picker.current?.scrollIntoView({ block: 'nearest' }); }
  }, [props.transfer?.mode, props.transfer?.sourceId]);
  type Canvas = typeof props.diagrams[number];
  const matches = (diagram: Canvas, items: Canvas[]): boolean => diagram.name.toLowerCase().includes(query.toLowerCase())
    || items.some(child => child.parentCanvasId === diagram.id && matches(child, items));
  const renderDiagram = (diagram: Canvas, items: Canvas[], showAll = false): ReactNode => {
    const includeChildren = showAll || diagram.name.toLowerCase().includes(query.toLowerCase());
    const children = items.filter(child => child.parentCanvasId === diagram.id && (includeChildren || matches(child, items)));
    return (
      <li key={diagram.id}>
        <div className="mapping-explorer-row">
          <button type="button" className={diagram.id === props.activeId ? "is-active" : ""}
            disabled={Boolean(props.deletingId) || !!props.transfer && (props.transfer.busy || diagram.id === props.transfer.sourceId || props.busyIds.includes(diagram.id))}
            aria-current={diagram.id === props.activeId ? "page" : undefined} data-project-diagram={diagram.id} onClick={() => props.onOpen(diagram.id)}>
            {diagram.name}{props.transfer && diagram.id === props.transfer.sourceId ? " (source)" : ""}{props.dirtyIds.includes(diagram.id) ? " *" : ""}
          </button>
          {!props.transfer && <button type="button" className="mapping-explorer-delete" aria-label={`Delete diagram ${diagram.name}`}
            title={`Delete ${diagram.name}`} disabled={props.deleteDisabled || props.busyIds.includes(diagram.id)}
            onClick={() => props.onDelete(diagram.id)}>{props.deletingId === diagram.id ? "…" : "×"}</button>}
        </div>
        {children.length > 0 && <ul className="mapping-canvas-children">{children.map(child => renderDiagram(child, items, includeChildren))}</ul>}
      </li>
    );
  };
  return <>
    <header><strong>{props.projectName}</strong><span>PROJECT DIAGRAMS</span></header>
    <div className="mapping-explorer-tabs" role="tablist" aria-label="Explorer mode">
      {(['diagrams','changes','canvas'] as const).map(tab => <button disabled={!!props.transfer} key={tab} role="tab" aria-selected={props.explorerTab === tab} onClick={() => props.onTabChange(tab)}>{tab === 'diagrams' ? 'Diagrams' : tab === 'canvas' ? 'Canvas' : 'Changes'}</button>)}
    </div>
    {props.explorerTab === 'canvas' ? props.canvas : props.explorerTab === 'changes' ? <ChangeSessionExplorer repositories={props.repositories ?? []} mode={props.changeMode} onSelect={props.onChangeSelect} /> : <>
    {props.transfer && <div ref={picker} tabIndex={-1} className="mapping-transfer-picker" aria-label="Choose destination canvas" aria-busy={props.transfer.busy}>
      <h2>{props.transfer.mode === 'copy' ? 'Copy' : 'Move'} {props.transfer.count} {props.transfer.count === 1 ? 'diagram' : 'diagrams'}</h2>
      <p role="status">{props.transfer.busy ? props.transfer.progress : newCanvas ? 'Name the new canvas, then confirm below.' : 'Choose an existing canvas below, or create a new one.'}</p>
      {props.transfer.error && <p className="mapping-transfer-error" role="alert">{props.transfer.error} Your selection is preserved. Retry below or cancel.</p>}
      {newCanvas ? <form onSubmit={event => { event.preventDefault(); if (name.trim() && !props.transfer!.busy) props.transfer!.onNew(name.trim()); }}>
        <label>New canvas name<input autoFocus aria-label="Transfer canvas name" value={name} maxLength={120} disabled={props.transfer.busy} onChange={event => setName(event.target.value)} /></label>
        <button type="submit" disabled={props.transfer.busy || !name.trim()}>{props.transfer.busy ? 'Saving…' : `${props.transfer.mode === 'copy' ? 'Copy' : 'Move'} diagrams to new canvas`}</button>
      </form> : <button type="button" disabled={props.transfer.busy} onClick={() => setNewCanvas(true)}>New canvas…</button>}
      <button type="button" disabled={props.transfer.busy} onClick={props.transfer.onCancel}>Cancel</button>
      {!props.transfer.busy && <p className="mapping-transfer-hint">Esc cancels and clears the selection.</p>}
    </div>}
    <input type="search" aria-label="Filter diagrams" placeholder="Find a diagram…" value={query} onChange={(event) => setQuery(event.target.value)} />
    <nav aria-label="Project diagrams"><ul>{repositoryGroups(props.repositories ?? [], props.diagrams).map(group => {
      const groupMatches = group.name.toLowerCase().includes(query.toLowerCase());
      const items = group.items;
      const roots = items.filter(diagram => !items.some(parent => parent.id === diagram.parentCanvasId))
        .filter(diagram => groupMatches || matches(diagram, items));
      return roots.length ? <RepositoryTreeGroup key={group.id} id={group.id} name={group.name}
        reveal={!!query || items.some(diagram => diagram.id === props.activeId)}>{roots.map(diagram => renderDiagram(diagram, items, groupMatches))}</RepositoryTreeGroup> : null;
    })}</ul></nav>
    {!props.diagrams.length && <p>No project diagrams yet. Create one with New.</p>}
    </>}
  </>;
}
