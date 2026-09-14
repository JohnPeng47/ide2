import { measureContent, type GridPoint } from '../core/lineGrid';
import { insertGridDiagram, type MappingGridDocument } from './mappingGrid';

export function normalizePastedDiagram(text: string): string {
  let ascii = text.replace(/\r\n?/g, '\n');
  const fenced = ascii.match(/^\s*```[^\n]*\n([\s\S]*?)\n```\s*$/);
  if (fenced) ascii = fenced[1];
  if (!ascii.trim()) throw new Error('Clipboard contains no diagram text.');
  if (ascii.length > 20000) throw new Error('Diagram is too large (maximum 20,000 characters).');
  measureContent(ascii);
  return ascii;
}

export function pasteGridDiagram(document: MappingGridDocument, point: GridPoint, text: string, id: string): MappingGridDocument {
  const ascii = normalizePastedDiagram(text);
  return insertGridDiagram(document, document.scene.root.id, {
    id, kind: 'diagram', contentId: id, collapsed: false, position: point
  }, { id, revision: 0, ascii, mappings: [] });
}
