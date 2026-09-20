import { z } from 'zod';
import type { DiagramContent } from './diagramContent';
import { diagramContentNodes } from './diagramContentNodes';

const id = z.string().min(1).max(500);
/** Destinations use catalog representation IDs, never ephemeral agent canvas/session IDs. */
export const diagramJumpSchema = z.object({
  id,
  source: z.object({
    revisionId: id, contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    line: z.number().int().positive(), startColumn: z.number().int().positive(), endColumn: z.number().int().positive(),
    contentNodeId: id.optional()
  }).strict(),
  target: z.object({
    representationId: id, displayNodeId: id.optional(), contentNodeId: id.optional()
  }).strict().refine(target => !target.contentNodeId || !!target.displayNodeId, 'A target node needs its display instance')
}).strict();
export type DiagramJump = z.infer<typeof diagramJumpSchema>;
export type DiagramJumpTarget = DiagramJump['target'];

/** Stale links are retained as metadata, but never attached to unrelated replacement text. */
export function activeDiagramJumps(content: DiagramContent, jumps: readonly DiagramJump[] = []): DiagramJump[] {
  const lines = content.ascii.split('\n');
  return jumps.filter(({ source }) => source.revisionId === content.revisionId && source.contentHash === content.asciiSha256
    && source.startColumn <= source.endColumn && source.endColumn <= (lines[source.line - 1]?.length ?? 0));
}

export function validateDiagramJumps(content: DiagramContent, input: unknown, allowStale = true): DiagramJump[] {
  const jumps = z.array(diagramJumpSchema).max(2000).parse(input ?? []);
  const seen = new Set<string>();
  for (const jump of jumps) {
    if (seen.has(jump.id)) throw new Error('Duplicate diagram jump ID');
    seen.add(jump.id);
    if (jump.source.endColumn < jump.source.startColumn) throw new Error('Invalid jump source range');
    const current = jump.source.revisionId === content.revisionId && jump.source.contentHash === content.asciiSha256;
    if (!current && allowStale) continue;
    if (!activeDiagramJumps(content, [jump]).length) throw new Error('STALE_JUMP_SOURCE');
    if (jump.source.contentNodeId) {
      const matches = diagramContentNodes(content).filter(node => node.line === jump.source.line
        && node.startColumn <= jump.source.startColumn && node.endColumn >= jump.source.endColumn);
      if (matches.length !== 1 || matches[0].id !== jump.source.contentNodeId) throw new Error('STALE_CONTENT_NODE');
    }
  }
  const active = activeDiagramJumps(content, jumps);
  for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
    const a = active[i].source, b = active[j].source;
    if (a.line === b.line && a.startColumn <= b.endColumn && b.startColumn <= a.endColumn) throw new Error('Overlapping diagram jumps');
  }
  return jumps;
}

/** Identical text may acquire a new revision on replacement or individual-diagram export. */
export function rebaseDiagramJumps(before: DiagramContent, after: DiagramContent, jumps: readonly DiagramJump[] = []): DiagramJump[] {
  if (before.ascii !== after.ascii) return structuredClone([...jumps]);
  return jumps.map(jump => {
    if (!activeDiagramJumps(before, [jump]).length) return structuredClone(jump);
    const node = diagramContentNodes(after).filter(node => node.line === jump.source.line
      && node.startColumn <= jump.source.startColumn && node.endColumn >= jump.source.endColumn);
    const { contentNodeId: _old, ...source } = jump.source;
    return { ...jump, source: { ...source, revisionId: after.revisionId, contentHash: after.asciiSha256,
      ...(node.length === 1 ? { contentNodeId: node[0].id } : {}) } };
  });
}
