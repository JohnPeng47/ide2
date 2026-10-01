import { importLegacySelection } from '../selection/importLegacySelection';
import { importLegacyCompactionPresentation } from './importLegacyCompactionPresentation';
import { CanvasHistory } from './canvasHistory';
import { canvasTransferSchema } from '../../core/diagrams/canvasTransfer';
import { validateCanvasJumps } from '../../core/diagrams/canvasJump';
import { validateDiagram } from '../../core/diagrams/diagram';
import { validateConnections } from '../../core/diagrams/diagramConnection';
import { normalizeDiagramViews } from './diagramViewState';
import { isRepositoryFilePath } from '../../core/source/sourceNavigation';
import { displayGeometry, type DisplayState, type SelectionRegion } from './displayModel';
import { layoutProjectedPanes } from './projectedPaneLayout';
import { layoutConversationPane } from '../chat/conversationPaneLayout';
import type { MappingWorkspaceSnapshot } from './mappingWorkspace';
import { flattenGrid, resolveScene, type GridBox, type LineGridScene } from '../../core/diagrams/lineGrid';
import { validateMappingPocMappings } from '../selection/mappingPocPrompt';

function check(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(`Invalid workspace: ${message}`); }
function object(value: unknown): asserts value is Record<string, any> { check(value && typeof value === 'object' && !Array.isArray(value), 'expected object'); }
function string(value: unknown) { check(typeof value === 'string', 'expected text'); }
function id(value: unknown) { string(value); check(value && !['__proto__', 'constructor', 'prototype'].includes(value as string), 'invalid ID'); }
function number(value: unknown) { check(typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 1e8, 'invalid coordinate'); }
function strings(value: unknown) { check(Array.isArray(value) && value.every(v => typeof v === 'string'), 'expected string array'); }
function rect(value: any) { object(value); for (const key of ['startLine', 'endLine', 'startColumn', 'endColumn']) check(Number.isInteger(value[key]) && value[key] > 0, 'invalid rectangle'); check(value.startLine <= value.endLine && value.startColumn <= value.endColumn, 'inverted rectangle'); }
function ranges(value: any) { check(Array.isArray(value), 'invalid ranges'); for (const r of value) { object(r); check(Number.isInteger(r.startLine) && r.startLine > 0 && Number.isInteger(r.endLine) && r.endLine >= r.startLine, 'invalid source range'); } }
function scene(value: any) {
  object(value); object(value.contents); object(value.root);
  check(Object.keys(value.contents).length <= 1000, 'too many scene contents');
  for (const [key, content] of Object.entries(value.contents)) {
    object(content); check(content.id === key, 'content ID mismatch');
    check(Number.isInteger(content.revision) && content.revision >= 0, 'invalid diagram revision');
    validateDiagram(content as import('../../core/diagrams/diagram').Diagram);

  }
  let count = 0;
  const expand = (box: any, depth: number): GridBox => {
    object(box); id(box.id); check(++count <= 2000 && depth < 100, 'invalid scene depth');
    check(typeof box.collapsed === 'boolean', 'invalid scene expansion');
    if (box.kind === 'diagram') { id(box.contentId); return { ...box, collapsed: false } as unknown as GridBox; }
    check(box.kind === 'container' && Array.isArray(box.children), 'invalid scene box');
    object(box.layout); check(box.layout.collisionPolicy === 'push-right', 'invalid scene layout');
    return { ...box, collapsed: false, children: box.children.map((child: any) => expand(child, depth + 1)) } as unknown as GridBox;
  };
  const expanded = expand(value.root, 0);
  resolveScene({ contents: value.contents, root: value.root as unknown as GridBox }); resolveScene({ contents: value.contents, root: expanded });
}
function geometry(value: any) {
  object(value); object(value.position); number(value.position.x); number(value.position.y);
  object(value.bounds); number(value.bounds.width); number(value.bounds.height);
  check(value.bounds.width > 0 && value.bounds.height > 0, 'invalid bounds');
  check(['canvas', 'viewport'].includes(value.coordinateSpace), 'invalid coordinate space');
}
/** v3 permits repository navigation; v1/v2 workspaces migrate on read. */
export function deserializeWorkspace(json: string | unknown): MappingWorkspaceSnapshot {
  const value = typeof json === 'string' ? JSON.parse(json) : structuredClone(json);
  object(value);
  check(value.schemaVersion === 1 || value.schemaVersion === 2 || value.schemaVersion === 3, 'unsupported schema version'); id(value.projectId);
  const legacy = value.schemaVersion === 1;
  check(Array.isArray(value.documents) && value.documents.length <= 100, 'invalid document list');
  const docs = new Set<string>();
  if (value.transfers !== undefined) {
    check(Array.isArray(value.transfers) && value.transfers.length <= 1000, 'invalid transfer history');
    value.transfers = value.transfers.map((transfer: unknown) => canvasTransferSchema.parse(transfer));
    check(new Set(value.transfers.map((transfer: any) => transfer.id)).size === value.transfers.length, 'duplicate transfer');
  }
  for (const doc of value.documents) {
    object(doc); id(doc.representationId); check(!docs.has(doc.representationId), 'duplicate document'); docs.add(doc.representationId);
    if (doc.hidden !== undefined) check(typeof doc.hidden === 'boolean', 'invalid canvas visibility');
    if (doc.savedRepresentationId !== undefined) id(doc.savedRepresentationId);
    if (doc.representationId.startsWith('draft-') && doc.revisionId === '') {} else id(doc.revisionId); string(doc.name); string(doc.savedName); string(doc.savedScene);
    object(doc.document); object(doc.document.scene); object(doc.document.sections);
    check(!Object.hasOwn(doc.document, 'nodes') && !Object.hasOwn(doc.document, 'evidence'), 'selection nodes and evidence belong to Diagram source contexts');
    scene(doc.document.scene);
    if (doc.document.jumps) doc.document.jumps = validateCanvasJumps(doc.document.scene as unknown as LineGridScene, doc.document.jumps);
    if (doc.history) new CanvasHistory(doc.document as unknown as import('./mappingGrid').MappingGridDocument, doc.canvas, doc.history);
    scene(JSON.parse(doc.savedScene));
    doc.document.edges = validateConnections(doc.document.scene as unknown as LineGridScene, doc.document.edges);
    if (doc.savedEdges !== undefined) {
      string(doc.savedEdges);
      validateConnections(JSON.parse(doc.savedScene), JSON.parse(doc.savedEdges));
    }
    for (const sections of Object.values(doc.document.sections)) {
      check(Array.isArray(sections), 'invalid sections');
      for (const section of sections) { object(section); id(section.id); string(section.label); number(section.startLine); number(section.endLine); }
    }
    object(doc.canvas); object(doc.canvas.display); object(doc.canvas.display.nodes); strings(doc.canvas.display.rootIds);
    if (doc.canvas.diagramViews !== undefined) {
      object(doc.canvas.diagramViews);
      check(Object.keys(doc.canvas.diagramViews).length <= 2000, 'too many diagram views');
      for (const [owner, view] of Object.entries(doc.canvas.diagramViews)) {
        id(owner); object(view); id(view.contentRevisionId); strings(view.collapsedContentNodeIds);
        check(view.collapsedContentNodeIds.length <= 20000, 'too many collapsed nodes');
        check(new Set(view.collapsedContentNodeIds).size === view.collapsedContentNodeIds.length, 'duplicate collapsed node');
      }
      const normalized = normalizeDiagramViews(doc.document.scene as unknown as LineGridScene, doc.canvas.diagramViews);
      check(JSON.stringify(normalized) === JSON.stringify(doc.canvas.diagramViews), 'stale diagram view or content node');
    }
    const { nodes, rootIds } = doc.canvas.display;
    check(Object.keys(nodes).length <= 2000, 'too many display nodes');
    for (const [key, node] of Object.entries(nodes)) {
      object(node); id(node.id); check(node.id === key, 'node key mismatch'); strings(node.childIds);
      check(['expanded', 'collapsed'].includes(node.expansion), 'invalid expansion');
      if (node.activeChildId !== undefined) check(node.childIds.includes(node.activeChildId), 'active child is not owned');
      for (const key of ['projectionId', 'sourceRevisionId', 'targetRevisionId']) if (node[key] !== undefined) id(node[key]);
      if (node.kind === 'selection') {
        if (node.selectionActive !== undefined) check(typeof node.selectionActive === 'boolean', 'invalid selection state');
        id(node.sourceBoxId); id(node.sourceContentId); string(node.sourceAscii); rect(node.rect); strings(node.selectedIds);
        check(['stacked', 'chained'].includes(node.displayMode), 'invalid display mode');
      } else if (node.kind === 'projection') {
        string(node.title); object(node.content);
        if (node.activeChildId !== undefined) check(node.childIds.includes(node.activeChildId), 'active child is not owned');
        if (node.content.kind === 'call-tree') {
          object(node.content.result); string(node.content.result.ascii); string(node.content.coverage);
          for (const key of ['matchedSourceEvidenceIds', 'unmatchedSourceEvidenceIds', 'targetNodeIds', 'visibleNodeIds', 'projectedNodeIds']) strings(node.content.result[key]);
          check(Array.isArray(node.content.result.rows), 'invalid projection rows');
          for (const row of node.content.result.rows) { object(row); id(row.nodeId); number(row.sourceLine); }
        } else if (node.content.kind === 'code-panel') {
          const content = node.content, panel = content.panel;
          id(content.selectionId); object(panel);
          const owner = nodes[content.selectionId];
          check(owner?.kind === 'selection' && owner.childIds.includes(node.id), 'invalid CodePanel owner');
          check(panel.mappedResourceType === 'source-range', 'invalid mapped resource type');
          id(panel.diagramId); id(panel.revisionId); string(panel.contentHash);
          check(panel.diagramId === owner.sourceContentId && /^[a-f0-9]{64}$/.test(panel.contentHash), 'invalid panel diagram snapshot');
          strings(panel.selectedNodeIds); strings(panel.unmappedNodeIds);
          check(new Set(panel.selectedNodeIds).size === panel.selectedNodeIds.length && panel.unmappedNodeIds.every((id: string) => panel.selectedNodeIds.includes(id)), 'invalid panel selection');
          check(Array.isArray(panel.items), 'invalid mapped resources');
          for (const item of panel.items) {
            object(item); object(item.resource); check(item.resource.type === panel.mappedResourceType, 'resource type mismatch');
            const target = item.resource.target; object(target); object(target.repo);
            id(target.repo.projectId); check(target.repo.projectId === value.projectId, 'resource belongs to another project');
            string(target.repo.sourceId); string(target.path); check(isRepositoryFilePath(target.path), 'invalid mapped source path');
            ranges([target]); string(target.rangeSha256); check(/^[a-f0-9]{64}$/.test(target.rangeSha256), 'invalid source snapshot hash');
            check(Array.isArray(item.origins) && item.origins.length > 0, 'missing mapping origins');
            for (const origin of item.origins) {
              object(origin); id(origin.selectedNodeId); id(origin.mappedNodeId); id(origin.mappingId);
              string(origin.selectedLabel); string(origin.mappedLabel);
              check(panel.selectedNodeIds.includes(origin.selectedNodeId), 'mapping origin is not selected');
            }
          }
          if (content.scroll !== undefined) {
            object(content.scroll); number(content.scroll.top); number(content.scroll.left);
            check(content.scroll.top >= 0 && content.scroll.left >= 0, 'invalid panel scroll');
          }
        } else {
          check(['compaction', 'source-code'].includes(node.content.kind) && Array.isArray(node.content.files), 'invalid pane content');
          for (const file of node.content.files) {
            object(file); string(file.sourceFile); string(file.sourceSha256); string(file.ascii); number(file.selectedLineCount);
            check(Array.isArray(file.rows), 'invalid compaction rows');
            for (const row of file.rows) { object(row); number(row.treeLine); check(typeof row.selected === 'boolean', 'invalid row selection'); ranges(row.sourceRanges); }
            if (file.ranges !== undefined) ranges(file.ranges);
            if (node.content.kind === 'source-code' && !file.ranges) {
              const imported = importLegacyCompactionPresentation(file as any);
              file.ranges = imported.entries.map(({ startLine, endLine }) => ({ startLine, endLine }));
              file.compactedSource = imported.compactedSource;
            }
          }
        }
        if (node.content.kind === 'source-code') {
          const content = node.content;
          if (content.sourceId !== undefined) id(content.sourceId);
          id(content.projectId); check(content.projectId === value.projectId, 'source pane belongs to another project');
          string(content.sourceFile);
          check(isRepositoryFilePath(content.sourceFile), 'invalid repository file path');
          if (value.schemaVersion < 3) check(content.files.some((file: any) => file.sourceFile === content.sourceFile), 'source file is not in the projected compactions');
          check(typeof content.showCompactions === 'boolean', 'invalid source overlay flag');
          check(Number.isInteger(content.rangeIndex) && content.rangeIndex >= 0, 'invalid source range index');
          if (content.scroll !== undefined) {
            object(content.scroll); number(content.scroll.top); number(content.scroll.left);
            check(content.scroll.top >= 0 && content.scroll.left >= 0, 'invalid source scroll position');
          }
        }
      } else if (node.kind === 'conversation') {
        check(['compact', 'floating', 'docked'].includes(node.presentation), 'invalid conversation presentation');
        string(node.draft); object(node.thread); id(node.thread.id); check(node.thread.id === node.id, 'thread ID mismatch'); string(node.thread.title);
        const anchor = legacy ? node.thread.anchor : node.canvasAnchor;
        object(anchor); number(anchor.x); number(anchor.y);
        object(node.thread.selection); rect(node.thread.selection.rect); strings(node.thread.selection.nodeIds); string(node.thread.selection.summary);
        check(Array.isArray(node.thread.messages), 'invalid messages');
        for (const message of node.thread.messages) { object(message); id(message.id); check(['user', 'assistant'].includes(message.role), 'invalid message role'); string(message.text); }
        node.thread.verbosity ??= 'low';
        check(['low', 'high'].includes(node.thread.verbosity), 'invalid chat verbosity');
        for (const key of ['error', 'progress']) if (node.thread[key] !== undefined) string(node.thread[key]);
        if (node.thread.context !== undefined) {
          const context = node.thread.context; object(context); id(context.contentId); string(context.diagramAscii);
          check(Number.isInteger(context.diagramRevision) && context.diagramRevision >= 0, 'invalid chat diagram revision');
          check(Array.isArray(context.mappings), 'invalid chat mappings');
          validateMappingPocMappings(context.diagramAscii, context.mappings);
          const projectIds = [context.projectId, context.representationId, context.baseRevisionId];
          if (projectIds.some(value => value !== undefined)) projectIds.forEach(id);
          id(node.thread.selection.boxId);
          if (context.sourceRanges !== undefined) {
            ranges(context.sourceRanges);
            for (const range of context.sourceRanges) {
              string(range.path); strings(range.lines);
              check(range.lines.length === range.endLine - range.startLine + 1, 'invalid frozen source lines');
            }
          }
        } else {
          // Older workspaces retain their transcripts, but cannot reconstruct the original evidence.
          node.thread.error = 'This saved conversation has no source context. Start a new conversation.';
        }
        if (node.thread.pending && node.thread.context) node.thread.error = 'Reply interrupted by workspace reload. Retry to continue.';
        delete node.thread.progress;
        node.thread.pending = false;
      } else if (node.kind === 'detail') { string(node.title); string(node.ascii); if (legacy) { number(node.x); number(node.y); } }
      else check(false, 'unsupported node kind');
      if (legacy) {
        Object.assign(node, displayGeometry());
        if (node.kind === 'detail') {
          node.position = { x: node.x, y: node.y }; node.geometryPolicy.placement = 'manual';
          delete node.x; delete node.y;
        } else if (node.kind === 'conversation') {
          node.canvasAnchor = node.thread.anchor; delete node.thread.anchor;
        } else if (node.kind === 'selection') {
          // v1 never saved font metrics. Seed an allocation; the live grid resolves it before paint.
          const box = flattenGrid(resolveScene(doc.document.scene as unknown as LineGridScene)).find(box => box.box.id === node.sourceBoxId);
          node.position = { x: ((box?.bounds.column ?? 0) + node.rect.startColumn - 1) * 8,
            y: ((box?.bounds.row ?? 0) + node.rect.startLine - 1) * 18 };
          node.bounds = { width: (node.rect.endColumn - node.rect.startColumn + 1) * 8,
            height: (node.rect.endLine - node.rect.startLine + 1) * 18 };
        }
      }
      geometry(node); object(node.geometryPolicy);
      check(['automatic', 'manual'].includes(node.geometryPolicy.placement), 'invalid placement policy');
      check(['content', 'fixed'].includes(node.geometryPolicy.sizing), 'invalid sizing policy');
      check(node.coordinateSpace === (node.kind === 'conversation' && node.presentation === 'docked' && node.expansion === 'expanded' ? 'viewport' : 'canvas') || legacy, 'inconsistent coordinate space');
      if (node.expandedGeometry !== undefined) {
        geometry(node.expandedGeometry);
        check(node.kind === 'conversation' || node.expandedGeometry.coordinateSpace === 'canvas', 'inconsistent expanded coordinate space');
      }
    }
    const seen = new Set<string>();
    const visit = (key: string, depth: number) => {
      check(depth < 100 && Object.hasOwn(nodes, key) && !seen.has(key), 'cycle, missing child, or duplicate ownership');
      seen.add(key); nodes[key].childIds.forEach((child: string) => visit(child, depth + 1));
    };
    rootIds.forEach((key: string) => visit(key, 0)); check(seen.size === Object.keys(nodes).length, 'unowned node');
    if (legacy) {
      let display = doc.canvas.display as DisplayState;
      for (const node of Object.values(display.nodes)) {
        if (node.kind === 'conversation') display = layoutConversationPane(display, node, { width: 1280, height: 720 });
      }
      for (const key of display.rootIds) if (display.nodes[key].kind === 'selection') {
        display = layoutProjectedPanes(display, display.nodes[key] as SelectionRegion).state;
      }
      doc.canvas.display = display;
    }
    const c = doc.canvas.controls; object(c);
    // Validate legacy fields before migration; new workspaces store only selection.items.
    if (!doc.canvas.selection) {
      if (c.selectedDiagramIds !== undefined) strings(c.selectedDiagramIds);
      strings(c.selectedNodeIds); if (c.selectionRect !== null) rect(c.selectionRect);
      if (c.retainedSelectionId !== null) check(Object.hasOwn(nodes, c.retainedSelectionId), 'missing control owner');
    }
    string(c.activeBoxId); object(c.surfaces); check(Object.hasOwn(c.surfaces, 'draft'), 'missing draft controls');
    for (const [owner, surface] of Object.entries(c.surfaces)) {
      check(owner === 'draft' || nodes[owner]?.kind === 'selection', 'missing control surface owner'); object(surface);
      surface.askVerbosity ??= 'low';
      check(['low', 'high'].includes(surface.askVerbosity), 'invalid ask verbosity');
      for (const key of ['projectionChoice', 'promptText', 'askText', 'statusMessage']) string(surface[key]);
      for (const key of ['actionsOpen', 'promptOpen', 'askOpen']) check(typeof surface[key] === 'boolean', 'invalid control flag');
      check(['compact', 'floating', 'docked'].includes(surface.presentation), 'invalid control presentation');
      check(['edit', 'generate'].includes(surface.promptOperation), 'invalid operation');
      check(['ready', 'composing', 'generating', 'applied', 'error'].includes(surface.promptPhase), 'invalid prompt phase');
      if (surface.promptPhase === 'generating') { surface.promptPhase = 'error'; surface.statusMessage = 'Operation interrupted by workspace reload; review before retrying.'; }
    }
    doc.canvas = importLegacySelection(doc.canvas as MappingWorkspaceSnapshot['documents'][number]['canvas'], doc.document.scene as unknown as LineGridScene);
    const selection = doc.canvas.selection; object(selection);
    check(Object.keys(selection).length === 1 && Array.isArray(selection.items) && selection.items.length <= 2000, 'invalid selection');
    const selectionIds = new Set<string>(), diagrams = new Set<string>(), regions = new Set<string>();
    for (const item of selection.items) {
      object(item); id(item.id); id(item.displayNodeId); check(item.displayNodeId.startsWith('grid:'), 'invalid selected diagram');
      check(!selectionIds.has(item.id), 'duplicate selection ID'); selectionIds.add(item.id);
      if (item.region !== undefined) {
        object(item.region); id(item.region.sourceContentId); string(item.region.sourceAscii);
        if (item.region.sourceRevisionId !== undefined) id(item.region.sourceRevisionId);
        rect(item.region.rect); strings(item.region.selectedIds); regions.add(item.displayNodeId);
      } else { check(!diagrams.has(item.displayNodeId), 'duplicate selected diagram'); diagrams.add(item.displayNodeId); }
    }
    check(![...diagrams].some(id => regions.has(id)), 'whole diagram overlaps selected region');
    const focusId = doc.canvas.controls.selectionFocusId;
    check(focusId === null || selection.items.some((item: any) => item.id === focusId && item.region), 'missing selection focus');
    if (c.activeThreadId !== null) check(Object.hasOwn(nodes, c.activeThreadId), 'missing control owner');
    if (c.activeThreadId) check(nodes[c.activeThreadId].kind === 'conversation', 'invalid conversation owner');
    if (doc.viewport) { object(doc.viewport); object(doc.viewport.offset); number(doc.viewport.offset.x); number(doc.viewport.offset.y); check(doc.viewport.scale >= .25 && doc.viewport.scale <= 4, 'invalid zoom'); }
  }
  for (const tx of value.transfers ?? []) {
    const source = value.documents.find((doc: any) => doc.representationId === tx.sourceId);
    const destination = value.documents.find((doc: any) => doc.representationId === tx.destinationId);
    check(source && destination && source !== destination, 'missing transfer participant');
    for (const [doc, before, after] of [[source, tx.sourceBefore, tx.sourceAfter], [destination, tx.destinationBefore, tx.destinationAfter]]) {
      check(doc.history?.snapshots[before] && doc.history?.snapshots[after], 'missing transfer checkpoint');
    }
    check(destination.history.snapshots[tx.destinationAfter].transactionId === tx.id, 'unlinked destination checkpoint');
    if (tx.mode === 'move') check(source.history.snapshots[tx.sourceAfter].transactionId === tx.id, 'unlinked source checkpoint');
  }
  if (value.activeDocumentId !== undefined) check(docs.has(value.activeDocumentId), 'missing active document');
  value.schemaVersion = 3;
  return value as unknown as MappingWorkspaceSnapshot;
}
export function serializeWorkspace(value: MappingWorkspaceSnapshot, pretty = true): string {
  // Validation also normalizes non-resumable operations in the saved copy, never live state.
  return JSON.stringify(deserializeWorkspace(value), null, pretty ? 2 : undefined);
}
