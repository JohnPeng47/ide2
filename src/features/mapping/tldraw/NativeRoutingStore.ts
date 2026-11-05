import { atom, computed, type Atom, type Computed, type Editor } from 'tldraw';
import { diagramRoutingObstacles, type RoutingObstacle } from '../../../../domain/mapping/workspace/routingObstacles';
import { ConnectionRouter, type RoutingInput } from '../../../../domain/mapping/workspace/connectionRouter';
import { previewEdge, type FloatingBoxArrow } from '../../../../domain/mapping/workspace/connectionLayout';
import type { DiagramConnection } from '../../../../domain/core/diagrams/diagramConnection';
import type { Diagram } from '../../../../domain/core/diagrams/diagram';
import type { DiagramViewState } from '../../../../domain/mapping/workspace/diagramViewState';
import { mappingShapeId } from './shapeProjection';

interface Owner { id: string; layoutKey: string; world: Computed<RoutingObstacle[]> }
interface RoutingJob { id: number; key: string; inputs: readonly RoutingInput[]; obstacles: RoutingObstacle[] }
interface RoutingDiagram { layoutKey: string; diagram?: Diagram; view?: DiagramViewState; cell: { width: number; height: number } }

/** Transient routing geometry. No DOM reads or document writes; camera changes are not dependencies. */
export class NativeRoutingStore {
  private readonly owners = atom<Owner[]>('routing obstacle owners', []);
  private readonly measurements = new Map<string, Atom<{ layoutKey: string; obstacles: RoutingObstacle[] } | undefined>>();
  private readonly router = new ConnectionRouter();
  private settled = new Map<string, FloatingBoxArrow>();
  private readonly completed = atom<{ key: string; arrows: Map<string, FloatingBoxArrow> } | undefined>('completed canvas routing', undefined);
  private worker?: Worker;
  private inFlight?: RoutingJob;
  private pending?: RoutingJob;
  private requested?: string;
  private serial = 0;
  readonly obstacles = computed('canvas routing obstacles', () => this.owners.get().flatMap(owner => owner.world.get()));
  constructor(private readonly editor: () => Editor | undefined,
    private createWorker: (() => Worker) | undefined = typeof Worker === 'undefined' ? undefined
      : () => new Worker(new URL('./routing.worker.ts', import.meta.url), { type: 'module' })) {}

  private measurement(id: string) {
    let record = this.measurements.get(id);
    if (!record) { record = atom<{ layoutKey: string; obstacles: RoutingObstacle[] } | undefined>(`routing measurements ${id}`, undefined); this.measurements.set(id, record); }
    return record;
  }
  setMeasurements(id: string, layoutKey: string, obstacles: RoutingObstacle[]) {
    const record = this.measurement(id), next = { layoutKey, obstacles };
    if (JSON.stringify(record.get()) !== JSON.stringify(next)) record.set(next);
  }

  sync(grids: ReadonlyMap<string, RoutingDiagram>, edges: readonly DiagramConnection[]) {
    for (const id of this.measurements.keys()) if (!grids.has(id)) this.measurements.delete(id);
    const prior = this.owners.get(), byId = new Map(prior.map(owner => [owner.id, owner]));
    const owners: Owner[] = [];
    for (const [id, model] of grids) {
      if (!model.diagram) continue;
      const old = byId.get(id);
      if (old?.layoutKey === model.layoutKey) { owners.push(old); continue; }
      const local = diagramRoutingObstacles(id, model.diagram.content, model.view, model.cell);
      const measurement = this.measurement(id);
      owners.push({ id, layoutKey: model.layoutKey, world: computed(`routing obstacles ${id}`, () => {
        const editor = this.editor(), shapeId = mappingShapeId(id);
        if (!editor?.getShape(shapeId)) return [];
        const transform = editor.getShapePageTransform(shapeId);
        const measured = measurement.get();
        return (measured?.layoutKey === model.layoutKey ? measured.obstacles : local).map(rect => {
          const corners = transform.applyToPoints([{ x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y },
            { x: rect.x, y: rect.y + rect.height }, { x: rect.x + rect.width, y: rect.y + rect.height }]);
          const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
          return { ...rect, x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
        });
      }) });
    }
    if (owners.length !== prior.length || owners.some((owner, index) => owner !== prior[index])) this.owners.set(owners);
    this.router.retain(edges);
  }

  drawAll(inputs: readonly RoutingInput[]) {
    // This reactive flag invalidates on pointer-up/cancel even without another move.
    if (this.editor()?.inputs?.getIsDragging()) return this.preview(inputs);
    const obstacles = this.obstacles.get();
    if (!this.createWorker) return this.settled = this.router.drawAll(inputs, obstacles);
    const key = JSON.stringify([inputs, obstacles]), completed = this.completed.get();
    if (completed?.key === key) return this.settled = completed.arrows;
    if (this.requested !== key) {
      this.requested = key;
      this.pending = { id: ++this.serial, key, inputs, obstacles };
      this.dispatch();
    }
    return this.preview(inputs);
  }
  private preview(inputs: readonly RoutingInput[]) {
    return new Map(inputs.map(([edge, source, target, , , geometry]) => [edge.id,
      previewEdge(edge, source, target, this.settled.get(edge.id), geometry)]));
  }
  private dispatch() {
    if (this.inFlight || !this.pending || !this.createWorker) return;
    try {
      if (!this.worker) {
        const worker = this.worker = this.createWorker();
        worker.onmessage = (event: MessageEvent<{ id: number; arrows: Map<string, FloatingBoxArrow>; error?: string }>) => {
          if (this.worker !== worker || event.data.id !== this.inFlight?.id) return;
          if (event.data.error) { this.failWorker(); return; }
          const job = this.inFlight; this.inFlight = undefined;
          // A worker can finish after newer geometry is requested. Never publish
          // that stale result; retain only the newest pending request.
          if (job.key === this.requested) this.completed.set({ key: job.key, arrows: event.data.arrows });
          this.dispatch();
        };
        worker.onerror = () => { if (this.worker === worker) this.failWorker(); };
      }
      const job = this.inFlight = this.pending; this.pending = undefined;
      this.worker.postMessage({ id: job.id, inputs: job.inputs, obstacles: job.obstacles });
    } catch { this.failWorker(); }
  }
  private failWorker() {
    this.worker?.terminate(); this.worker = undefined; this.createWorker = undefined;
    this.inFlight = this.pending = undefined; this.requested = undefined;
    // Publish on a later task: construction/postMessage can fail while a
    // computed read is running, where reactive writes are not allowed.
    queueMicrotask(() => this.completed.set({ key: 'worker-failed', arrows: new Map() }));
  }
  dispose() {
    this.worker?.terminate(); this.worker = undefined; this.inFlight = this.pending = undefined;
    this.requested = undefined; this.completed.set(undefined); this.settled = new Map();
  }
  draw(...input: RoutingInput) { return this.router.draw(input, this.obstacles.get()); }
}
