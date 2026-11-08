export const linkedOutput = () => ({ explanation: 'Root links to detail.', rootCanvas: 'root', canvases: [
  { kind: 'new', id: 'detail', name: 'Detail', diagrams: [{ id: 'd', ascii: 'Details\n`-- Evidence', position: { column: 0, row: 0 } }], edges: [] },
  { kind: 'new', id: 'root', name: 'Overview', diagrams: [{ id: 'r', ascii: 'Overview\n`-- Open detail', position: { column: 0, row: 0 } }], edges: [] }
], jumps: [{ source: { canvas: 'root', diagram: 'r', line: 2, startColumn: 5, endColumn: 15 }, target: { canvas: 'detail', diagram: 'd', line: 1 } }] });

