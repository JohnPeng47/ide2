import { unavailablePlanSelection, validatePlanRecord } from '../../../domain/core/plans/plans';
import { SCHEMA_VERSION } from '../../../domain/core/records/domain';
import { ApplicationError } from '../errors';
import type { DiagramRepository } from '../ports/diagramRepository';

export class PlanService {
  constructor(private readonly store: Pick<DiagramRepository, 'loadProject' | 'loadPlan' | 'loadPlans' | 'savePlan' | 'ids'>) { }
  list() { return this.store.loadPlans(); }
  get(id: string) { return this.store.loadPlan(id); }
  async create(body: Record<string, unknown>) {
    const project = await this.store.loadProject();
    if (!project) throw new ApplicationError('conflict', 'project is not initialized');
    const timestamp = new Date().toISOString();
    const plan = validatePlanRecord({
      schemaVersion: SCHEMA_VERSION,
      id: typeof body.id === 'string' ? body.id : this.store.ids.plan(), projectId: project.id,
      title: body.title, status: body.status ?? 'draft', markdown: body.markdown,
      selection: body.selection ?? unavailablePlanSelection(), changes: body.changes ?? [],
      createdAt: timestamp, updatedAt: timestamp
    });
    return this.store.savePlan(plan);
  }
  async update(id: string, body: Record<string, unknown>) {
    const current = await this.store.loadPlan(id);
    const plan = validatePlanRecord({
      ...current,
      ...(body.title === undefined ? {} : { title: body.title }),
      ...(body.status === undefined ? {} : { status: body.status }),
      ...(body.markdown === undefined ? {} : { markdown: body.markdown }),
      ...(body.selection === undefined ? {} : { selection: body.selection }),
      ...(body.changes === undefined ? {} : { changes: body.changes }), updatedAt: new Date().toISOString()
    });
    return this.store.savePlan(plan);
  }
}
