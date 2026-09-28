import { z } from 'zod';
import { diagramJumpSchema, validateDiagramJumps } from './diagramJump';
import { connectionBox } from './diagramConnection';
import type { LineGridScene } from './lineGrid';
export const canvasJumpSchema = diagramJumpSchema.extend({ sourceDisplayNodeId: z.string().min(1), label: z.string().optional() });
export type CanvasJump = z.infer<typeof canvasJumpSchema>;
export function validateCanvasJumps(scene: LineGridScene, input: unknown): CanvasJump[] {
  const jumps = z.array(canvasJumpSchema).max(4000).parse(input ?? []);
  if (new Set(jumps.map(jump => jump.id)).size !== jumps.length) throw Error('Duplicate canvas jump');
  for (const jump of jumps) {
    const box = connectionBox(scene, jump.sourceDisplayNodeId);
    if (box?.kind !== 'diagram') throw Error('Jump source diagram is missing');
    const { sourceDisplayNodeId, label, ...link } = jump;
    validateDiagramJumps(scene.contents[box.contentId].content, [link]);
  }
  return jumps;
}
