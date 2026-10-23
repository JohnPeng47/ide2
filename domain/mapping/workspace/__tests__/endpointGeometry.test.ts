import { describe, expect, it, vi } from 'vitest';
import { RevisionedDiagramService } from '../../../core/diagrams/diagramService';
import { connectionContentNodes, diagramConnectionSchema, defaultArrowAppearance, type DiagramConnection } from '../../../core/diagrams/diagramConnection';
import { singleDiagramScene } from '../../../core/diagrams/projectDiagramCanvas';
import { drawEdge, drawResolvedEdge, resolveEndpoint } from '../connectionLayout';
import { endpointKey, type EndpointBounds, type EndpointRect } from '../endpointGeometry';
import { routeEdge, type EndpointSide } from '../edgeRouting';
import { MappingDocumentController } from '../mappingDocumentController';
import { mappingDocumentFromScene } from '../mappingDocument';
import { initialCanvasState } from '../mappingWorkspace';

function fixture() {
  const scene = singleDiagramScene('Root\n|-- Parent\n|   `-- Child');
  scene.contents = { ...scene.contents, overview: new RevisionedDiagramService().create({ id: 'overview', revision: 0,
    ascii: scene.contents.overview.content.ascii, structureKind: 'tree' }).diagram };
  if (scene.root.kind !== 'container') throw new Error();
  scene.root.children = [...scene.root.children, { ...scene.root.children[0], id: 'second', position: { column: 50, row: 2 } }];
  const content = scene.contents.overview.content;
  const child = connectionContentNodes(content).find(node => node.label === 'Child')!;
  const parent = connectionContentNodes(content).find(node => node.label === 'Parent')!;
  const edge: DiagramConnection = { id: 'edge', source: { kind: 'content-node', displayNodeId: 'grid:overview',
    contentNodeId: child.id, revisionId: content.revisionId, side: 'right', offset: 0.25 },
    target: { kind: 'box', displayNodeId: 'grid:second', side: 'left', offset: 0.75 }, appearance: defaultArrowAppearance };
  const a = { x: 121.375, y: 80.125, width: 69.4375, height: 14.875 };
  const b = { x: 400.0625, y: 100.3125, width: 135.875, height: 98.625 };
  const bounds: EndpointBounds = { [endpointKey(edge.source)]: a, [endpointKey(resolveEndpoint(scene, undefined, edge.target, { width: 8, height: 18 }, true)!.identity)]: b };
  return { scene, content, parent, edge, a, b, bounds };
}

describe('measured edge attachments', () => {
  it('resolves explicit label positions in canvas pixels and keeps legacy automatic placement', () => {
    const { edge, scene, bounds } = fixture();
    const position = { x: -12.5, y: 210.25 };
    const positioned = { ...edge, appearance: { ...edge.appearance, label: { text: 'Calls', position } } };
    expect(diagramConnectionSchema.parse(positioned)).toEqual(positioned);
    const arrow = drawEdge(positioned, scene, undefined, { width: 8, height: 18 }, bounds);
    expect(arrow.label).toEqual({ text: 'Calls', position });
    const shifted = Object.fromEntries(Object.entries(bounds).map(([id, rect]) => [id, { ...rect, x: rect.x + 100 }]));
    expect(drawEdge(positioned, scene, undefined, { width: 8, height: 18 }, shifted).label).toEqual(arrow.label);
    for (const label of ['Calls', { text: 'Calls' }]) {
      const automatic = drawEdge({ ...edge, appearance: { ...edge.appearance, label } }, scene, undefined, { width: 8, height: 18 }, bounds);
      expect(automatic.label).toEqual({ text: 'Calls', position: {
        x: (automatic.source!.x + automatic.target!.x) / 2,
        y: (automatic.source!.y + automatic.target!.y) / 2 - 8
      } });
    }
  });

  it('rejects incomplete or non-finite label positions and unsupported sizing fields', () => {
    const { edge } = fixture();
    for (const label of [
      { text: 'Calls', position: { x: 1 } },
      { text: 'Calls', position: { x: Infinity, y: 2 } },
      { text: 'Calls', position: { x: 1, y: NaN } },
      { text: 'Calls', position: { x: 1, y: 2 }, width: 100 },
      { position: { x: 1, y: 2 } }
    ]) expect(() => diagramConnectionSchema.parse({ ...edge, appearance: { ...edge.appearance, label } })).toThrow();
  });

  it('uses the measured span border and side offsets, independently of cell estimates', () => {
    const { edge, scene, bounds, a, b } = fixture();
    const result = drawEdge(edge, scene, undefined, { width: 7.1, height: 18.2 }, bounds);
    expect(result).toMatchObject({ status: 'resolved', geometrySource: 'measured',
      source: { x: a.x + a.width, y: a.y + a.height * 0.25 }, target: { x: b.x, y: b.y + b.height * 0.75 } });
    // Cell estimates now determine other text obstacles, but never move measured attachment points.
    expect(drawEdge(edge, scene, undefined, { width: 99, height: 200 }, bounds)).toMatchObject({ source: result.source, target: result.target });
    expect(drawEdge(edge, scene, undefined, { width: 8, height: 18 }).geometrySource).toBe('estimated');
  });

  it('distinguishes waiting for a measured element from a stale semantic anchor', () => {
    const { edge, scene } = fixture();
    const pending = drawEdge(edge, scene, undefined, { width: 8, height: 18 }, {});
    const stale = drawEdge({ ...edge, source: { ...edge.source, revisionId: 'old' } }, scene, undefined,
      { width: 8, height: 18 }, {});
    expect(pending.status).toBe('pending'); expect(pending.path).toBeUndefined();
    expect(stale.status).toBe('stale'); expect(stale.path).toBeUndefined();
  });

  it('uses measured ancestors for subtree folds and measured GridBoxes for whole-box folds', () => {
    const { edge, scene, parent, content, bounds, b } = fixture();
    const parentIdentity = { ...edge.source, contentNodeId: parent.id };
    const parentRect = { x: 100.25, y: 60.75, width: 50.5, height: 15.5 };
    const views = { 'grid:overview': { contentRevisionId: content.revisionId, collapsedContentNodeIds: [parent.id] } };
    const folded = drawEdge(edge, scene, views, { width: 8, height: 18 }, { ...bounds, [endpointKey(parentIdentity)]: parentRect });
    expect(folded).toMatchObject({ status: 'proxy', source: { x: 150.75, y: 64.625, proxy: true } });
    if (scene.root.kind !== 'container') throw new Error();
    scene.root.children = scene.root.children.map(box => box.id === 'overview' ? { ...box, collapsed: true } : box);
    expect(drawEdge(edge, scene, views, { width: 8, height: 18 }, {
      [endpointKey({ displayNodeId: 'grid:overview' })]: parentRect, [endpointKey(resolveEndpoint(scene, undefined, edge.target, { width: 8, height: 18 }, true)!.identity)]: b
    })).toMatchObject({ status: 'proxy', source: { x: 150.75, proxy: true } });
  });

  it('updates measurements without dirtying documents, changing edit versions or adding undo entries', () => {
    const { scene, edge, bounds } = fixture();
    const controller = new MappingDocumentController(mappingDocumentFromScene(scene, [edge]), initialCanvasState(), 0, undefined, {});
    const before = controller.getSnapshot(), listener = vi.fn();
    controller.subscribe(listener);
    controller.configureEndpointBounds(bounds);
    expect(controller.getSnapshot()).toMatchObject({ version: 0, canUndo: false, canRedo: false });
    expect(controller.getSnapshot().document).toBe(before.document);
    expect(controller.getSnapshot().canvas).toBe(before.canvas);
    const measured = controller.getSnapshot();
    controller.configureEndpointBounds(structuredClone(bounds));
    expect(controller.getSnapshot()).toBe(measured);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(controller.nodes().find(node => node.kind === 'arrow')).toMatchObject({ value: { geometrySource: 'measured', status: 'resolved' } });
    controller.transact(0, [{ method: 'move', nodeId: 'grid:second', position: { column: 60, row: 4 } }]);
    expect(controller.getSnapshot().endpointBounds).toEqual({});
    expect(controller.nodes().find(node => node.kind === 'arrow')).toMatchObject({ value: { status: 'pending' } });
    controller.configureEndpointBounds(bounds);
    controller.undo();
    expect(controller.getSnapshot().document).toEqual(before.document);
    expect(controller.getSnapshot().endpointBounds).toEqual({});
  });

  it('leaves missing offsets absent in stored edges and validates explicit offsets', () => {
    const { edge } = fixture();
    const old = structuredClone(edge); delete old.source.offset; delete old.target.offset;
    expect(diagramConnectionSchema.parse(old)).toEqual(old);
    expect(() => diagramConnectionSchema.parse({ ...edge, source: { ...edge.source, offset: 1.1 } })).toThrow();
  });
});

describe('routing around endpoint boxes', () => {
  it('chooses a cheaper left/left route even when the preferred side pair has a valid detour', () => {
    const { edge } = fixture();
    const a = { x: 100, y: 0, width: 100, height: 20, proxy: false };
    const b = { x: 100, y: 120, width: 40, height: 20, proxy: false };
    const obstacles = [{ x: 100, y: 30, width: 400, height: 80 }];
    for (const side of ['horizontal', 'auto'] as const) {
      const flexible = diagramConnectionSchema.parse({ ...edge, source: { ...edge.source, side, offset: 0.5 },
        target: { ...edge.target, side, offset: 0.5 } });
      const arrow = drawResolvedEdge(flexible, a, b, 'measured', undefined, obstacles);
      expect(arrow).toMatchObject({ status: 'resolved', source: { side: 'left' }, target: { side: 'left' } });
      expect(arrow.path).toBe('M100 10 L84 10 L84 130 L100 130');
      const fixed = drawResolvedEdge({ ...flexible, target: { ...flexible.target, side: 'right' } }, a, b, 'measured', undefined, obstacles);
      expect(fixed.status).toBe('resolved');
      expect(fixed.target?.side).toBe('right');
      expect(fixed.bounds.width).toBeGreaterThan(arrow.bounds.width);
    }
  });

  it('restricts horizontal attachment to left/right even when top/bottom would be shorter', () => {
    const { edge } = fixture();
    const a = { x: 100, y: 0, width: 100, height: 20, proxy: false };
    const b = { ...a, y: 120 };
    const horizontal = { ...edge, source: { ...edge.source, side: 'horizontal' as const, offset: 0.5 },
      target: { ...edge.target, side: 'horizontal' as const, offset: 0.5 } };
    const arrow = drawResolvedEdge(horizontal, a, b);
    expect(['left', 'right']).toContain(arrow.source?.side);
    expect(['left', 'right']).toContain(arrow.target?.side);
    const automatic = drawResolvedEdge({ ...horizontal, source: { ...horizontal.source, side: 'auto' }, target: { ...horizontal.target, side: 'auto' } }, a, b);
    expect(automatic).toMatchObject({ source: { side: 'bottom' }, target: { side: 'top' }, path: 'M150 20 L150 120' });
  });

  const sides: EndpointSide[] = ['left', 'right', 'top', 'bottom'];
  const anchor = (r: EndpointRect, side: EndpointSide) => ({ side,
    x: side === 'left' ? r.x : side === 'right' ? r.x + r.width : r.x + r.width / 2,
    y: side === 'top' ? r.y : side === 'bottom' ? r.y + r.height : r.y + r.height / 2 });
  it('keeps fixed sides and never crosses either box for all 16 side combinations', () => {
    for (const b of [{ x: 220, y: 50, width: 80, height: 60 }, { x: 20, y: 200, width: 80, height: 60 }]) {
      const a = { x: 20, y: 30, width: 90, height: 70 };
      for (const sourceSide of sides) for (const targetSide of sides) {
        const source = anchor(a, sourceSide), target = anchor(b, targetSide);
        const points = routeEdge(source, target, [a, b]);
        expect(points, `${sourceSide} -> ${targetSide}`).toBeDefined();
        expect(points![0]).toEqual(source); expect(points!.at(-1)).toEqual(target);
        const outward = (p: typeof source, q: { x: number; y: number }) => p.side === 'left' ? q.x < p.x && q.y === p.y
          : p.side === 'right' ? q.x > p.x && q.y === p.y : p.side === 'top' ? q.y < p.y && q.x === p.x : q.y > p.y && q.x === p.x;
        expect(outward(source, points![1])).toBe(true);
        expect(outward(target, points!.at(-2)!)).toBe(true);
        for (let i = 1; i < points!.length; i++) {
          const p = points![i - 1], q = points![i];
          expect(p.x === q.x || p.y === q.y).toBe(true);
          // Sample interiors independently of the routing implementation.
          for (let t = 0.01; t < 1; t += 0.01) {
            const x = p.x + (q.x - p.x) * t, y = p.y + (q.y - p.y) * t;
            expect([a, b].some(r => x > r.x && x < r.x + r.width && y > r.y && y < r.y + r.height)).toBe(false);
          }
        }
      }
    }
  });

  it('routes through narrow gaps and reports impossible overlapping attachments instead of crossing text', () => {
    const a = { x: 0, y: 0, width: 40, height: 30 }, b = { x: 42, y: 0, width: 30, height: 30 };
    expect(routeEdge(anchor(a, 'right'), anchor(b, 'left'), [a, b])).toBeDefined();
    const enclosing = { x: -10, y: -10, width: 100, height: 100 };
    expect(routeEdge(anchor(a, 'right'), anchor(enclosing, 'left'), [a, enclosing])).toBeUndefined();
  });
});


describe('diagram destination roots', () => {
  it('resolves the root label while keeping the saved diagram reference and source box semantics', () => {
    const { scene, edge } = fixture(), saved = structuredClone(edge.target), cell = { width: 8, height: 18 };
    const target = resolveEndpoint(scene, undefined, edge.target, cell, true)!;
    expect(target.rect).toMatchObject({ x: 400, y: 36, width: 32, height: 18 });
    expect(target.identity.contentNodeId).toBeTruthy();
    expect(resolveEndpoint(scene, undefined, edge.target, cell)!.identity.contentNodeId).toBeUndefined();
    scene.contents = { ...scene.contents, overview: new RevisionedDiagramService().create({ id: 'overview', revision: 1,
      ascii: 'New root\n`-- Descendant', structureKind: 'tree' }).diagram };
    const next = resolveEndpoint(scene, undefined, edge.target, cell, true)!;
    expect(next.identity.revisionId).not.toBe(target.identity.revisionId);
    expect(next.rect.width).toBe(64);
    expect(edge.target).toEqual(saved);
  });
  it('uses the visible summary root when the destination diagram is collapsed', () => {
    const { scene, edge } = fixture(), cell = { width: 8, height: 18 };
    scene.contents = { ...scene.contents, summary: new RevisionedDiagramService().create({ id: 'summary', revision: 0,
      ascii: 'Summary', structureKind: 'tree' }).diagram };
    if (scene.root.kind !== 'container') throw new Error();
    scene.root.children = scene.root.children.map(box => box.id === 'second' ? { ...box, collapsed: true, collapsedContentId: 'summary' } : box);
    const target = resolveEndpoint(scene, undefined, edge.target, cell, true)!;
    expect(target.rect).toMatchObject({ width: 56, height: 18, proxy: true });
    expect(target.labelRect).toBe(true);
    const arrow = drawEdge(edge, scene, undefined, cell);
    expect(arrow.target).toMatchObject({ x: 400, y: 49.5, proxy: true });
  });
});
