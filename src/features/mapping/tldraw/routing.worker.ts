import { ConnectionRouter, type RoutingInput } from '../../../../domain/mapping/workspace/connectionRouter';
import type { RoutingObstacle } from '../../../../domain/mapping/workspace/routingObstacles';

const router = new ConnectionRouter();
self.onmessage = (event: MessageEvent<{ id: number; inputs: RoutingInput[]; obstacles: RoutingObstacle[] }>) => {
  const { id, inputs, obstacles } = event.data;
  try { self.postMessage({ id, arrows: router.drawAll(inputs, obstacles) }); }
  catch (error) { self.postMessage({ id, error: String(error) }); }
};
