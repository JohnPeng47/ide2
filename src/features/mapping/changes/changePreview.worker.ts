import type { ChangeSessionPreview } from '../../../../domain/mapping/changes/diagramChangeSession';
import { diffChangeDocument } from '../../../../domain/mapping/changes/changeDocumentDiff';
self.onmessage = async ({ data }: MessageEvent<{ endpoint: string }>) => {
  try {
    const response = await fetch(data.endpoint, { cache: 'no-store' });
    const session = await response.json() as ChangeSessionPreview | null;
    if (!response.ok) throw Error((session as unknown as { error?: string })?.error ?? 'Could not load preview');
    const diff = session ? diffChangeDocument(session.document) : undefined;
    self.postMessage({ session, diff });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
