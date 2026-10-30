import { connectionObstacles, type RoutingObstacle } from './routingObstacles';
import type { EndpointIdentity, EndpointRect } from './endpointGeometry';
import { overlapsRoute } from './edgeRouting';
import { drawResolvedEdge, spaceEdgeArrows, type FloatingBoxArrow } from './connectionLayout';
import type { DiagramConnection } from '../../core/diagrams/diagramConnection';

export type RoutingInput = readonly [DiagramConnection, Parameters<typeof drawResolvedEdge>[1], Parameters<typeof drawResolvedEdge>[2],
  EndpointIdentity | undefined, EndpointIdentity | undefined, FloatingBoxArrow['geometrySource']];
interface CachedRoute { key: string; region?: EndpointRect; obstacles: string; result: FloatingBoxArrow }

/** Pure routing cache shared by the browser worker and headless callers. */
export class ConnectionRouter {
  private laneCache?: { key: string; arrows: Map<string, FloatingBoxArrow> };
  private routes = new Map<string, CachedRoute>();
  retain(edges: readonly DiagramConnection[]) {
    const live = new Set(edges.map(edge => edge.id));
    for (const id of this.routes.keys()) if (!live.has(id)) this.routes.delete(id);
  }
  drawAll(inputs: readonly RoutingInput[], obstacles: readonly RoutingObstacle[]) {
    this.retain(inputs.map(input => input[0]));
    const entries = inputs.map(input => ({ arrow: this.draw(input, obstacles),
      obstacles: [...connectionObstacles(obstacles, input[3], input[4]), ...[input[1], input[2]].filter(rect => !!rect)] }));
    const key = JSON.stringify([entries.map(entry => entry.arrow), inputs.map(input => input.slice(1, 5)), obstacles]);
    if (this.laneCache?.key === key) return this.laneCache.arrows;
    const arrows = new Map(spaceEdgeArrows(entries).map(arrow => {
      const previous = this.laneCache?.arrows.get(arrow.edgeId);
      return [arrow.edgeId, previous && JSON.stringify(previous) === JSON.stringify(arrow) ? previous : arrow];
    }));
    this.laneCache = { key, arrows }; return arrows;
  }
  draw([edge, source, target, sourceIdentity, targetIdentity, geometrySource]: RoutingInput, allObstacles: readonly RoutingObstacle[]) {
    const obstacles = connectionObstacles(allObstacles, sourceIdentity, targetIdentity);
    const key = JSON.stringify([edge, source, target, geometrySource]), previous = this.routes.get(edge.id);
    const nearby = (region?: EndpointRect) => JSON.stringify((region ? obstacles.filter(rect => overlapsRoute(rect, region)) : obstacles)
      .map(rect => [rect.x, rect.y, rect.width, rect.height, rect.kind]));
    if (previous?.key === key && previous.obstacles === nearby(previous.region)) return previous.result;
    const result = drawResolvedEdge(edge, source, target, geometrySource, undefined, obstacles);
    const region = result.path ? { x: result.position.x, y: result.position.y, ...result.bounds } : undefined;
    this.routes.set(edge.id, { key, region, obstacles: nearby(region), result }); return result;
  }
}
