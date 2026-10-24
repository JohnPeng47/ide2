import type { AgentContextSnapshot } from '../agents/agentContext';
import type { Diagram, DiagramInput } from './diagram';
import type { SubtreeRange } from './diagramSubtreeEdit';

/** The parts of a template parameter that rendering needs. */
export type GenerationPromptParameter =
  | { kind: 'enum'; key: string; options: readonly { value: string; guidance: string }[] }
  | { kind: 'number'; key: string };
export interface DiagramGenerationRequest {
  /** Authoritative parsed-node -> logical-node identities, supplied by the revision model. */
  nodeRefs?: Readonly<Record<string, string>>;
  agentContext?: AgentContextSnapshot;
  llmSessionId?: string;
  input: Omit<DiagramInput, 'revision' | 'ascii'>;
  instruction: string;
  /** Structured prompt: a validated template with options plus resolved, revision-pinned references. */
  prompt?: {
    markdown: string;
    options: Readonly<Record<string, string | number>>;
    parameters: readonly GenerationPromptParameter[];
    references: readonly unknown[];
  };
  baseRevisionId?: string;
  operation?: 'edit-diagram' | 'create-diagram' | 'extend-diagram';
  sourceMappings?: boolean;
  editRange?: SubtreeRange;
  editRanges?: SubtreeRange[];
  context?: {
    diagram: Diagram;
    connections?: readonly import('./diagramConnection').DiagramConnection[];
    selection: { startLine: number; endLine: number; startColumn: number; endColumn: number };
    projectId?: string; representationId?: string; baseRevisionId?: string;
  };
}
export interface GenerationOptions {
  signal?: AbortSignal; onProgress?: (message: string) => void;
  onAgentSession?: (sessionId: string) => void;
  onAgentContext?: (context: AgentContextSnapshot) => void;
}
export interface DiagramGenerator {
  generate(request: DiagramGenerationRequest, options: GenerationOptions): Promise<Omit<DiagramInput, 'id' | 'revision'> & { nodeCorrespondence?: Record<string, number>; replacementRanges?: SubtreeRange[] }>;
}
