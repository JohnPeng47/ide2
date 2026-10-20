import { z } from 'zod';

export const connectionIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);
export const commitShaSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const refSchema = z.string().min(1).max(1024).regex(/^refs\//);
const envName = z.string().regex(/^[A-Z][A-Z0-9_]*$/);
const remoteUrl = z.string().url().refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
}, 'Use an HTTPS Git URL without embedded credentials');
const externalRepository = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('artifacts'), accountId: z.string().regex(/^[a-f0-9]{32}$/),
    namespace: z.string().min(1).max(200), repoName: z.string().min(1).max(200) }).strict(),
  z.object({ provider: z.literal('generic'), repositoryKey: z.string().min(1).max(500) }).strict()
]);
export const repositoryConnectionSchema = z.object({
  id: connectionIdSchema,
  repositoryId: z.string().min(1).max(200),
  external: externalRepository,
  remoteUrl,
  /** Name of a server environment variable containing a Git Bearer token, never its value. */
  credentialEnv: envName.optional(),
  canvasId: z.string().min(1).max(200).optional(),
  enabled: z.boolean().default(true)
}).strict().superRefine((connection, ctx) => {
  if (connection.external.provider !== 'artifacts') return;
  const { accountId, namespace, repoName } = connection.external;
  const url = new URL(connection.remoteUrl);
  if (url.origin !== `https://${accountId}.artifacts.cloudflare.net`
    || decodeURIComponent(url.pathname) !== `/git/${namespace}/${repoName}.git`) {
    ctx.addIssue({ code: 'custom', message: 'Artifacts remote must match the configured account, namespace and repo' });
  }
});
export type RepositoryConnection = z.infer<typeof repositoryConnectionSchema>;

export const pushEventSchema = z.object({
  eventId: z.string().min(1).max(500),
  ref: refSchema,
  before: commitShaSchema.nullable(),
  after: commitShaSchema.nullable(),
  occurredAt: z.iso.datetime({ offset: true }).optional()
}).strict().transform(event => ({ ...event,
  before: event.before && !/^0+$/.test(event.before) ? event.before : null,
  after: event.after && !/^0+$/.test(event.after) ? event.after : null
}));
export type PushEvent = z.infer<typeof pushEventSchema>;
export type PushKind = 'update' | 'new-branch' | 'force-push' | 'delete' | 'unchanged';
export interface ResolvedPush {
  kind: PushKind;
  commits: string[];
  hasChanges: boolean;
}
export interface PushGeneration {
  id: string;
  connectionId: string;
  repositoryId: string;
  event: PushEvent;
  kind?: PushKind;
  commits: string[];
  status: 'resolving' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'skipped';
  workflowRunId?: string;
  changeSessionId?: string;
  reason?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}
