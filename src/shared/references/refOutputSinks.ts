import type { ReferenceIdentity } from "../../../domain/core/records/domain";

export interface OutputSink<TPayload> {
  send(payload: TPayload): Promise<void>;
}

export class ClipboardSink implements OutputSink<string> {
  async send(text: string): Promise<void> {
    await navigator.clipboard.writeText(text);
  }
}

export interface ReferenceEnvelope {
  schemaVersion: 2;
  projectId: string;
  diagramSetId: string;
  sourceArtifactId?: string;
  references: ReferenceIdentity[];
}

export const REFERENCE_ENVELOPE_EVENT = "new-diagram:reference-buffer";

export class WindowReferenceSink implements OutputSink<ReferenceEnvelope> {
  async send(payload: ReferenceEnvelope): Promise<void> {
    window.dispatchEvent(new CustomEvent<ReferenceEnvelope>(REFERENCE_ENVELOPE_EVENT, { detail: payload }));
  }
}

export function createReferenceEnvelope(input: {
  projectId: string;
  diagramSetId: string;
  sourceArtifactId?: string;
  references: ReferenceIdentity[];
}): ReferenceEnvelope {
  return {
    schemaVersion: 2,
    projectId: input.projectId,
    diagramSetId: input.diagramSetId,
    ...(input.sourceArtifactId ? { sourceArtifactId: input.sourceArtifactId } : {}),
    references: [...input.references]
  };
}
