import { z } from 'zod';

export const strategyCodes = ['1a', '1b', '2', '3', '4'] as const;
export type StrategyCode = typeof strategyCodes[number];
export const diagramChangeProposalSchema = z.object({ tree: z.string().min(1).max(50000) }).strict();
const countsSchema = z.object({ '1a': z.number().int().nonnegative(), '1b': z.number().int().nonnegative(), '2': z.number().int().nonnegative(), '3': z.number().int().nonnegative(), '4': z.number().int().nonnegative() }).strict();
export const diagramChangeTreeResultSchema = z.object({
  parser: z.literal('diagram-change-tree'), version: z.literal(1),
  outputs: z.array(z.object({ runId: z.string(), outputKey: z.string(), text: z.string(), valid: z.boolean(),
    counts: countsSchema, issues: z.array(z.object({ line: z.number().int().positive(), message: z.string() })),
    operations: z.array(z.object({ line: z.number().int().positive(), canvas: z.string(), code: z.enum(strategyCodes), description: z.string() }))
  })),
  totals: countsSchema, validOutputs: z.number().int().nonnegative(),
  outputsUsing3: z.number().int().nonnegative(), outputsUsing4: z.number().int().nonnegative()
}).strict();
export type DiagramChangeTreeResult = z.infer<typeof diagramChangeTreeResultSchema>;
const emptyCounts = (): Record<StrategyCode, number> => ({ '1a': 0, '1b': 0, '2': 0, '3': 0, '4': 0 });

/** Parse syntax, never infer intent from prose or reward a strategy for being selected. */
export function parseDiagramChangeTree(text: string) {
  const counts = emptyCounts(), issues: { line: number; message: string }[] = [];
  const operations: DiagramChangeTreeResult['outputs'][number]['operations'] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let canvas = '', canvasKind = '', canvasDepth = -1, operationDepth = -1, header = false, lastDepth = -1;
  const issue = (line: number, message: string) => issues.push({ line, message });
  lines.forEach((raw, index) => {
    const line = index + 1;
    if (!raw.trim()) return;
    if (!header) {
      header = true;
      if (raw.trim() !== 'Proposed diagram changes') issue(line, 'Expected root: Proposed diagram changes');
      return;
    }
    if (/^[ |│]*$/.test(raw)) return;
    const branch = raw.match(/^([ |│]*)(?:\|--|`--|├──|└──)\s+(.+)$/);
    if (!branch) { issue(line, 'Expected a tree branch; prose and code fences are not tree output'); return; }
    const depth = branch[1].length, label = branch[2];
    if (depth < 2 || (depth - 2) % 4 !== 0) issue(line, 'Indent child branches in four-column steps');
    if (lastDepth >= 0 && depth > lastDepth + 4) issue(line, 'Tree skips an indentation level');
    lastDepth = depth;
    const canvasMatch = label.match(/^(.*?)\s{2,}(existing canvas|new canvas)\s*$/i);
    if (canvasMatch) {
      if (depth !== 2) issue(line, 'Canvas branches must be indented two spaces');
      if (canvasDepth >= 0 && depth !== canvasDepth) issue(line, 'Canvas branches must share one indentation level');
      canvasDepth = depth; canvasKind = canvasMatch[2].toLowerCase(); operationDepth = -1;
      canvas = canvasMatch[1].trim();
      const tagged = canvas.match(/^\[([^\]]+)\]\s+(.+)$/);
      if (tagged) {
        if (tagged[1] !== '3' || canvasKind !== 'new canvas') issue(line, 'Only [3] may label a new canvas branch');
        else { counts['3']++; operations.push({ line, canvas, code: '3', description: tagged[2] }); }
      } else if (canvasKind === 'new canvas') issue(line, 'Label a new canvas branch with [3]');
      return;
    }
    const tag = label.match(/^\[([^\]]+)\]\s*(.*)$/);
    if (tag) {
      if (!strategyCodes.includes(tag[1] as StrategyCode)) { issue(line, `Unknown strategy [${tag[1]}]`); return; }
      if (!canvas || depth !== canvasDepth + 4) { issue(line, 'Operations must be direct children of a canvas'); return; }
      if (!tag[2].trim()) { issue(line, 'Operation needs a description'); return; }
      const code = tag[1] as StrategyCode;
      if (code === '3') { issue(line, 'Put [3] on the new canvas branch, not a diagram operation'); return; }
      if (canvasKind === 'new canvas' && ['1a', '1b', '2', '4'].includes(code)) issue(line, 'This operation requires an existing canvas');
      counts[code]++; operations.push({ line, canvas, code, description: tag[2] }); operationDepth = depth;
    } else if (!canvas || depth <= canvasDepth || (canvasKind === 'existing canvas' && (operationDepth < 0 || depth <= operationDepth))) {
      issue(line, 'Expected a tagged operation under this canvas');
    }
  });
  if (!header) issue(1, 'Missing root: Proposed diagram changes');
  if (!canvas) issue(1, 'No canvas branches found');
  if (!operations.length) issue(1, 'No recognized operations found');
  return { valid: issues.length === 0, counts, issues, operations };
}

export function judgeDiagramChangeTrees(inputs: { runId: string; outputKey: string; text: string }[]): DiagramChangeTreeResult {
  const outputs = inputs.map(input => ({ ...input, ...parseDiagramChangeTree(input.text) }));
  const totals = emptyCounts();
  for (const output of outputs) for (const code of strategyCodes) totals[code] += output.counts[code];
  return { parser: 'diagram-change-tree', version: 1, outputs, totals,
    validOutputs: outputs.filter(o => o.valid).length,
    outputsUsing3: outputs.filter(o => o.counts['3'] > 0).length, outputsUsing4: outputs.filter(o => o.counts['4'] > 0).length };
}
