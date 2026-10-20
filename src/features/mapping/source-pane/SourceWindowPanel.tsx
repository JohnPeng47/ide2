import { useCallback, useContext, useEffect, useMemo } from 'react';
import { useStore } from 'zustand';
import { diagramSource } from '../../../../domain/core/diagrams/diagram';
import { sha256 } from '../../../../domain/core/sha256';
import { setExpansion, visibleProjectionIds, type ProjectedPane } from '../../../../domain/mapping/workspace/displayModel';
import type { CanvasSession } from '../workspace/canvasSession';
import { useMappingServices } from '../services/MappingServices';
import { WindowPanel } from '../window-panel/WindowPanel';
import { useSaveWindowPanelState, useWindowPanelState } from '../window-panel/windowPanelState';
import { SourcePaneDocumentContext } from './SourcePaneViewStateContext';
import { SessionCodePanel } from '../code-panel/SessionCodePanel';
import { SourceCodePane } from './SourceCodePane';
import { updateSourceCodePane, type SourceCodePaneView } from './sourceCodePane';
import './sourceWindowPanel.css';

export function SourceWindowPanel({ session, projectId, active }: { session: CanvasSession; projectId?: string; active: boolean }) {
  const { codeRepo } = useMappingServices();
  const documentId = useContext(SourcePaneDocumentContext);
  const contents = useStore(session.document, state => state.document.scene.contents);
  const display = useStore(session.presentation, state => state.display);
  const focus = useStore(session.controls, state => state.selectionFocusId);
  const storageKey = `mapped-source:${documentId}`;
  const [state, setState] = useWindowPanelState(storageKey);
  useSaveWindowPanelState(storageKey, state);
  const files = useMemo(() => {
    const files = new Map<string, { repo: { projectId: string; sourceId: string }; path: string; ranges: Set<string> }>();
    if (!projectId) return [];
    for (const diagram of Object.values(contents)) for (const { entity, range, binding } of diagramSource(diagram).entries()) {
      if (!range) continue;
      const repo = { projectId, sourceId: entity?.sourceId ?? binding?.sourceId ?? '' };
      const key = JSON.stringify([repo.sourceId, range.path]);
      const file = files.get(key) ?? { repo, path: range.path, ranges: new Set<string>() };
      file.ranges.add(JSON.stringify([range.startLine, range.endLine, range.originalLines])); files.set(key, file);
    }
    return [...files.values()].map(({ repo, path, ranges }) => ({ repo, path, version: sha256([...ranges].sort().join('\n')) }));
  }, [contents, projectId]);
  useEffect(() => { if (active) codeRepo.preloadFiles?.(files); }, [codeRepo, files, active]);
  const visible = new Set(Object.values(display.nodes).flatMap(node => node.kind === 'selection' ? visibleProjectionIds(display, node.id, node.displayMode) : []));
  const panes = Object.values(display.nodes).filter((node): node is ProjectedPane => visible.has(node.id) && node.kind === 'projection'
    && ['source-code', 'code-panel'].includes(node.content.kind) && node.expansion === 'expanded');
  const pane = panes.find(node => node.content.kind === 'code-panel' && node.content.selectionId === focus) ?? panes.at(-1);
  const changeSource = useCallback((id: string, patch: Partial<SourceCodePaneView>) => session.controller.updateCanvas(current => ({
    ...current, display: updateSourceCodePane(current.display, id, patch)
  }), true), [session]);
  const close = () => session.controller.updateCanvas(current => {
    let next = current.display;
    for (const node of panes) next = setExpansion(next, node.id, 'collapsed');
    return { ...current, display: next };
  }, true);
  if (!active || !pane) return null;
  return <div className="source-window-host" data-mapping-static-ui data-diagram-canvas-static-ui
    data-display-node={pane.id} data-pane-content={pane.content.kind}>
    <WindowPanel title={pane.content.kind === 'source-code' ? pane.content.sourceFile : 'Mapped source'} canvasId={documentId} sizeStorageKey={storageKey}
      state={{ ...state, mode: 'full-single', pane: 'tree', focusedPane: 'tree', minimized: false, expandedWidth: state.expandedWidth ?? .45 }}
      onChange={patch => setState(previous => ({ ...previous, ...patch }))} onClose={close} canvas={null}
      panes={[{ id: 'tree', title: 'Source', content: pane.content.kind === 'code-panel' ? <SessionCodePanel key={pane.id} session={session} id={pane.id} />
        : pane.content.kind === 'source-code' ? <SourceCodePane key={pane.id} id={pane.id} content={pane.content} onChange={changeSource} /> : null }]} />
  </div>;
}
