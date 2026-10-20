import { measureContent } from '../../core/diagrams/lineGrid';

/** Preserve layout while accepting a text clipboard payload or one Markdown fence. */
export function normalizePastedDiagram(text: string): string {
  let ascii = text.replace(/\r\n?/g, '\n');
  const fenced = ascii.match(/^\s*```[^\n]*\n([\s\S]*?)\n```\s*$/);
  if (fenced) ascii = fenced[1];
  if (!ascii.trim()) throw new Error('Paste contains no diagram text.');
  if (ascii.length > 20000) throw new Error('Diagram is too large (maximum 20,000 characters).');
  measureContent(ascii);
  return ascii;
}
