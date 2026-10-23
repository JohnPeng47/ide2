import { atom, computed, type Computed, type Editor } from 'tldraw';
import { diagramRoutingObstacles, connectionObstacles, type RoutingObstacle } from '../../../../domain/mapping/workspace/routingObstacles';
import type { EndpointIdentity, EndpointRect } from '../../../../domain/mapping/workspace/endpointGeometry';
import { overlapsRoute } from '../../../../domain/mapping/workspace/edgeRouting';
import { drawResolvedEdge, spaceEdgeArrows, type FloatingBoxArrow } from '../../../../domain/mapping/workspace/connectionLayout';
import type { DiagramConnection } from '../../../../domain/core/diagrams/diagramConnection';
import type { Diagram } from '../../../../domain/core/diagrams/diagram';
import type { DiagramViewState } from '../../../../domain/mapping/workspace/diagramViewState';
import { mappingShapeId } from './shapeProjection';

interface Owner { id: string; layoutKey: string; world: Computed<RoutingObstacle[]> }
interface CachedRoute { key: string; region?: EndpointRect; obstacles: string; result: FloatingBoxArrow }
interface RoutingDiagram { layoutKey: string; diagram?: Diagram; view?: DiagramViewState; cell: { width: number; height: number } }

/** Transient routing geometry. No DOM reads or document writes; camera changes are not dependencies. */
export class NativeRoutingStore {
  private readonly owners = atom<Owner[]>('routing obstacle owners', []);
  private laneCache?: { key: string; arrows: Map<string, FloatingBoxArrow> };
  private readonly routes = new Map<string, CachedRoute>();
  readonly obstacles = computed('canvas routing obstacles', () => this.owners.get().flatMap(owner => owner.world.get()));
  constructor(private readonly editor: () => Editor | undefined) {}

  sync(grids: ReadonlyMap<string, RoutingDiagram>, edges: readonly DiagramConnection[]) {
    const prior = this.owners.get(), byId = new Map(prior.map(owner => [owner.id, owner]));
    const owners: Owner[] = [];
    for (const [id, model] of grids) {
      if (!model.diagram) continue;
      const old = byId.get(id);
      if (old?.layoutKey === model.layoutKey) { owners.push(old); continue; }
      const local = diagramRoutingObstacles(id, model.diagram.content, model.view, model.cell);
      owners.push({ id, layoutKey: model.layoutKey, world: computed(`routing obstacles ${id}`, () => {
        const editor = this.editor(), shapeId = mappingShapeId(id);
        if (!editor?.getShape(shapeId)) return [];
        const transform = editor.getShapePageTransform(shapeId);
        return local.map(rect => {
          const corners = transform.applyToPoints([{ x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y },
            { x: rect.x, y: rect.y + rect.height }, { x: rect.x + rect.width, y: rect.y + rect.height }]);
          const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
          return { ...rect, x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
        });
      }) });
    }
    if (owners.length !== prior.length || owners.some((owner, index) => owner !== prior[index])) this.owners.set(owners);
    const live = new Set(edges.map(edge => edge.id));
    for (const id of this.routes.keys()) if (!live.has(id)) this.routes.delete(id);
  }

  drawAll(inputs: readonly Readonly<Parameters<NativeRoutingStore['draw']>>[]) {
    const obstacles = this.obstacles.get();
    const entries = inputs.map(input => ({ arrow: this.draw(...input),
      obstacles: [...connectionObstacles(obstacles, input[3], input[4]), ...[input[1], input[2]].filter(rect => !!rect)] }));
    const key = JSON.stringify([entries.map(entry => entry.arrow), inputs.map(input => input.slice(1, 5)), obstacles]);
    if (this.laneCache?.key === key) return this.laneCache.arrows;
    const arrows = new Map(spaceEdgeArrows(entries).map(arrow => {
      const previous = this.laneCache?.arrows.get(arrow.edgeId);
      return [arrow.edgeId, previous && JSON.stringify(previous) === JSON.stringify(arrow) ? previous : arrow];
    }));
    this.laneCache = { key, arrows };
    return arrows;
  }

  draw(edge: DiagramConnection, source: Parameters<typeof drawResolvedEdge>[1], target: Parameters<typeof drawResolvedEdge>[2],
    sourceIdentity: EndpointIdentity | undefined, targetIdentity: EndpointIdentity | undefined, geometrySource: FloatingBoxArrow['geometrySource']) {
    const obstacles = connectionObstacles(this.obstacles.get(), sourceIdentity, targetIdentity);
    const key = JSON.stringify([edge, source, target, geometrySource]), previous = this.routes.get(edge.id);
    const nearby = (region?: EndpointRect) => JSON.stringify((region ? obstacles.filter(rect => overlapsRoute(rect, region)) : obstacles)
      .map(rect => [rect.x, rect.y, rect.width, rect.height, rect.kind]));
    // A moved obstacle outside the existing route's bounding rectangle cannot intersect that route.
    if (previous?.key === key && previous.obstacles === nearby(previous.region)) return previous.result;
    const result = drawResolvedEdge(edge, source, target, geometrySource, undefined, obstacles);
    const region = result.path ? { x: result.position.x, y: result.position.y, ...result.bounds } : undefined;
    this.routes.set(edge.id, { key, region, obstacles: nearby(region), result });
    return result;
  }
}
