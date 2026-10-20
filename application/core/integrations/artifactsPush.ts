import { createHash } from 'node:crypto';
import { z } from 'zod';
import { commitShaSchema, pushEventSchema, type RepositoryConnection } from '../../../domain/core/integrations/pushIntegration';

// Cloudflare's push payload has no event ID. Its timestamp + repository/ref transition
// identifies a push independently of Queue message IDs or subscription redelivery.
const artifactsEvent = z.object({
  type: z.literal('cf.artifacts.repo.pushed'),
  source: z.object({ type: z.literal('artifacts.repo'), namespace: z.string(), repoName: z.string() }),
  payload: z.object({ ref: z.string(), before: commitShaSchema.nullable(), after: commitShaSchema.nullable() }),
  metadata: z.object({ accountId: z.string(), eventSchemaVersion: z.literal(1), eventTimestamp: z.iso.datetime({ offset: true }) })
});
export function decodeArtifactsPush(connection: RepositoryConnection, raw: unknown) {
  const event = artifactsEvent.parse(raw);
  const external = connection.external;
  if (external.provider !== 'artifacts' || external.accountId !== event.metadata.accountId
    || external.namespace !== event.source.namespace || external.repoName !== event.source.repoName) {
    throw Error('Push does not belong to the connected Artifacts repository');
  }
  const eventId = createHash('sha256').update(JSON.stringify([external, event.metadata.eventTimestamp,
    event.payload.ref, event.payload.before, event.payload.after])).digest('hex');
  return pushEventSchema.parse({ eventId, ...event.payload, occurredAt: event.metadata.eventTimestamp });
}
