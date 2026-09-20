import { normalizeSource } from './source';
import { DEFAULT_GLYPHS, recognize } from './recognizers';
import { interpretLayout } from './layout';
import { interpretTrees } from './trees';
import { interpretWires } from './wires';
import type { DiagramInterpretation, ParseOptions, Policy } from './types';

export type * from './types';
export { DEFAULT_GLYPHS, DEFAULT_RECOGNIZERS } from './recognizers';
export { sourceSpan } from './source';
export { renderCleaned } from './render';
export type { RenderedDiagram } from './render';

function policyFor(options: ParseOptions): Policy {
  const policy: Policy = { dialect: options.dialect ?? 'mixed', tabSize: options.tabSize ?? 4,
    treeTolerance: options.treeTolerance ?? 1, wireTolerance: options.wireTolerance ?? 2,
    continuation: options.continuation ?? 'auto', detachedLists: options.detachedLists ?? 'auto',
    repairs: options.repairs ?? 'conservative', maxChars: options.maxChars ?? 1_000_000,
    maxColumns: options.maxColumns ?? 100_000, maxCandidates: options.maxCandidates ?? 100_000,
    maxNodes: options.maxNodes ?? 10_000, maxMatchingCells: options.maxMatchingCells ?? 100_000,
    ...(options.compatibility ? { compatibility: options.compatibility } : {}) };
  for (const [key, choices] of Object.entries({ dialect: ['tree', 'graph', 'mixed', 'unknown'],
    continuation: ['auto', 'join', 'separate'], detachedLists: ['auto', 'include'], repairs: ['conservative', 'none'] })) {
    if (!choices.includes(String(policy[key as keyof Policy]))) throw new TypeError(`Invalid ${key}`);
  }
  if (policy.compatibility && (!['ascii-tree-1', 'ascii-tree-2'].includes(policy.compatibility) || policy.dialect !== 'tree')) throw new TypeError('Compatibility profile requires tree dialect');
  for (const [name, value] of Object.entries(policy)) if (typeof value === 'number' &&
    (!Number.isSafeInteger(value) || value < (name.endsWith('Tolerance') ? 0 : 1))) throw new RangeError(`Invalid ${name}`);
  return Object.freeze(policy);
}

/** Pure, synchronous parser shared by browser and server. No Python or runtime dependencies. */
export function parseDiagram(input: string, options: ParseOptions = {}): DiagramInterpretation {
  if (typeof input !== 'string') throw new TypeError('Diagram input must be a string');
  const policy = policyFor(options);
  if (input.length > policy.maxChars) throw new RangeError('Diagram exceeds maxChars');
  const diagnostics: DiagramInterpretation['diagnostics'] = [];
  const source = normalizeSource(input, policy, diagnostics);
  const glyphs = Object.freeze({ ...DEFAULT_GLYPHS, ...options.glyphs });
  const result: DiagramInterpretation = { parserVersion: 'spatial-diagram-1', source, policy, glyphs,
    candidates: recognize(source, policy, glyphs, options.recognizers ?? [], diagnostics),
    nodes: [], edges: [], regions: [], decisions: [], repairs: [], unresolved: [], diagnostics,
    lines: source.rows.map(row => ({ line: row.line, kind: row.kind, nodeIds: [] })) };
  const { labels, wires } = interpretLayout(result, glyphs);
  interpretTrees(result, labels, wires);
  interpretWires(result, labels, wires);
  return result;
}

/** An explanation contains actual decisions and evidence, never inferred confidence percentages. */
export function explainNode(result: DiagramInterpretation, nodeId: string) {
  const node = result.nodes.find(n => n.id === nodeId);
  if (!node) return undefined;
  const decisions = result.decisions.filter(d => node.decisionIds.includes(d.id) ||
    result.edges.some(e => (e.from === nodeId || e.to === nodeId) && e.decisionId === d.id));
  const repairIds = new Set(decisions.flatMap(d => d.repairIds));
  return { node, decisions, repairs: result.repairs.filter(r => repairIds.has(r.id)),
    unresolved: result.unresolved.filter(u => u.spans.some(s => node.spans.some(n => n.start < s.end && s.start < n.end)) ||
      u.alternatives.some(a => a.nodeIds?.includes(nodeId))) };
}
