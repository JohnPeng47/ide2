import { z } from 'zod';

export const diagramMarkerRulesSchema = z.array(z.object({
  id: z.string().min(1).max(100),
  marker: z.string().min(1).max(32).regex(/^[!-~]+$/).refine(value => !value.includes('\\'), 'Markers cannot contain escapes')
}).strict()).max(64).refine(rules => new Set(rules.map(rule => rule.id)).size === rules.length
  && new Set(rules.map(rule => rule.marker)).size === rules.length, 'Duplicate marker rule');
export type DiagramMarkerRule = Readonly<z.infer<typeof diagramMarkerRulesSchema>[number]>;
export interface DiagramMarkerSpan { start: number; end: number; markerRuleId: string }

/** Literal, non-nested pairs. Raw text and source columns are never rewritten. */
export function diagramMarkerSpans(text: string, rules: readonly DiagramMarkerRule[]): DiagramMarkerSpan[] {
  const result: DiagramMarkerSpan[] = [];
  const ordered = [...rules].sort((a, b) => b.marker.length - a.marker.length || a.id.localeCompare(b.id));
  const escaped = (at: number) => { let slashes = 0; while (at > 0 && text[--at] === '\\') slashes++; return slashes % 2 === 1; };
  for (let i = 0; i < text.length; i++) {
    if (escaped(i)) { const literal = ordered.find(rule => text.startsWith(rule.marker, i)); if (literal) i += literal.marker.length - 1; continue; }
    const rule = ordered.find(rule => text.startsWith(rule.marker, i) && /[ \t]/.test(text[i + rule.marker.length] ?? ''));
    if (!rule) continue;
    const start = i + rule.marker.length;
    let end = text.indexOf(rule.marker, start);
    while (end >= 0 && (escaped(end) || !/[ \t]/.test(text[end - 1] ?? ''))) end = text.indexOf(rule.marker, end + 1);
    if (end < 0) continue;
    const leading = text.slice(start, end).match(/^[ \t]*/)?.[0].length ?? 0;
    const trailing = text.slice(start, end).match(/[ \t]*$/)?.[0].length ?? 0;
    if (start + leading < end - trailing) result.push({ start: start + leading, end: end - trailing, markerRuleId: rule.id });
    i = end + rule.marker.length - 1;
  }
  return result;
}
