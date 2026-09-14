import type { BuiltInDomainProfileId } from '../../domain/core/profiles/domainProfile';
import type { CoreApplication } from '../core/application';
import type { DiagramRepository } from '../core/ports/diagramRepository';
import type { DiagramAgentRuntime } from './generation/agent';
export interface StudioContext {
  store: DiagramRepository; core: CoreApplication; agents: DiagramAgentRuntime;
  defaultDomainProfileId: BuiltInDomainProfileId;
  activeBatches: Set<string>; activeMappings: Set<string>;
}
