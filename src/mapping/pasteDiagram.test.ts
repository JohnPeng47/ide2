import { describe, expect, it } from 'vitest';
import { resolveScene } from '../core/lineGrid';
import { initialMappingGrid } from './mappingGrid';
import { normalizePastedDiagram, pasteGridDiagram } from './pasteDiagram';

describe('clipboard diagram insertion', () => {
  it('preserves indentation and blank rows while normalizing newlines and a code fence', () => {
    expect(normalizePastedDiagram('```text\r\n  Root\r\n  |-- Child\r\n\r\n```\r\n')).toBe('  Root\n  |-- Child\n');
    expect(normalizePastedDiagram('  Root\n\n')).toBe('  Root\n\n');
  });
  it.each(['', ' \r\n ', '```\n \n```', 'Root\tChild', 'Root\u0000', '─', 'x'.repeat(20001)])('rejects invalid clipboard case %#', text => {
    expect(() => normalizePastedDiagram(text)).toThrow();
  });
  it('anchors pasted content, pushes overlapping siblings, and leaves the input unchanged', () => {
    const document = initialMappingGrid();
    const before = structuredClone(document);
    const next = pasteGridDiagram(document, { column: 0, row: 0 }, '[New]\n  |', 'pasted');
    const boxes = resolveScene(next.scene).children;
    expect(boxes.find(box => box.box.id === 'pasted')?.bounds).toMatchObject({ column: 0, row: 0, columns: 5, rows: 2 });
    expect(boxes.find(box => box.box.id === 'overview')?.bounds.column).toBe(8);
    expect(next.scene.contents.pasted).toEqual({ id: 'pasted', revision: 0, ascii: '[New]\n  |', mappings: [] });
    expect(next.nodes.pasted).toEqual([]);
    expect(document).toEqual(before);
  });
  it('rejects insertion beyond canvas limits without changing the document', () => {
    const document = initialMappingGrid();
    const before = structuredClone(document);
    expect(() => pasteGridDiagram(document, { column: 20000, row: 0 }, 'xx', 'pasted')).toThrow();
    expect(document).toEqual(before);
  });
});
