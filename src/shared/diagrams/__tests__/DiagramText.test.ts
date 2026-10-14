import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { DiagramText } from '../DiagramText';
import { PanelConnector } from '../PanelConnector';
import { buildDiagramContent } from '../../../../domain/core/diagrams/diagramContent';
import { diagramTextRanges, textRow } from '../../../../domain/core/diagrams/diagramText';

it('renders exact text with one node outline across mapping boundaries and a separately addressable jump', () => {
  const ascii = 'Root\n|-- [*] Rendering  \n';
  const content = buildDiagramContent(ascii, 'v1', 'tree');
  const ranges = diagramTextRanges({ ascii, content, displayNodeId: 'grid:copy',
    mappings: [{ id: 'mapping', entityId: 'e', sourceRangeIndex: 0, line: 2, startColumn: 9, endColumn: 12 }],
    jumps: [{ id: 'jump', source: { revisionId: content.revisionId, contentHash: content.asciiSha256,
      line: 2, startColumn: 5, endColumn: 17 }, target: { representationId: 'saved-canvas' } }] });
  const rows = ascii.split('\n').map((line, i) => textRow(line, ranges.get(i + 1)!));
  const html = renderToStaticMarkup(createElement(DiagramText, { rows, onJump: () => {} }));
  expect(html.replace(/<[^>]+>/g, '')).toBe(ascii);
  expect(html.match(/class="diagram-content-node"/g)).toHaveLength(2);
  expect(html).toContain('data-display-node-id="grid:copy"');
  expect(html).toContain('data-node-mapping-ids="mapping"');
  expect(html.match(/data-diagram-jump-id="jump"/g)).toHaveLength(1);
});

it('orients the shared open arrowhead for each target side', () => {
  const expected = { left: 'M5 17 L10 20 L5 23', right: 'M15 23 L10 20 L15 17',
    top: 'M13 15 L10 20 L7 15', bottom: 'M7 25 L10 20 L13 25' };
  for (const side of ['left', 'right', 'top', 'bottom'] as const) {
    const html = renderToStaticMarkup(createElement(PanelConnector, { path: 'M0 0 L10 20', target: { x: 10, y: 20, side } }));
    expect(html).toContain(expected[side]);
    expect(html).toContain('stroke-width="1"');
    expect(html).toContain('fill="none"');
  }
});

it('keeps syntax inside one jump button and lets review wrappers retain their highlighting', () => {
  const ascii = 'Root\n`-- applyUpdate(value)';
  const content = buildDiagramContent(ascii, 'v1', 'tree');
  const ranges = diagramTextRanges({ ascii, content, displayNodeId: 'grid:a', jumps: [{ id: 'jump',
    source: { revisionId: content.revisionId, contentHash: content.asciiSha256, line: 2, startColumn: 5, endColumn: 22 },
    target: { representationId: 'destination' } }] });
  const rows = ascii.split('\n').map((line, i) => textRow(line, ranges.get(i + 1)!));
  const html = renderToStaticMarkup(createElement(DiagramText, { rows, onJump: () => {},
    renderRun: (_run, text) => createElement('span', { className: 'change-diff-modified' }, text) }));
  expect(html.replace(/<[^>]+>/g, '')).toBe(ascii);
  expect(html.match(/data-diagram-jump-id="jump"/g)).toHaveLength(1);
  expect(html).toContain('syntax-function');
  expect(html).toContain('syntax-variable');
  expect(html).toContain('change-diff-modified');
  expect(html.match(/class="diagram-content-node"/g)).toHaveLength(2);
});
