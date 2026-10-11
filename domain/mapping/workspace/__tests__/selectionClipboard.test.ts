import { expect, it } from 'vitest';
import { singleDiagramScene } from '../../../core/diagrams/projectDiagramCanvas';
import { selectionClipboardText } from '../selectionClipboard';

it('copies complete rows for a narrow multi-line canvas selection, preserving whitespace', () => {
  const diagram = singleDiagramScene('Root\n  |-- Long branch  \n\n  `-- Leaf\nOutside').contents.overview;
  expect(selectionClipboardText(diagram, {
    startLine: 2, endLine: 4, startColumn: 7, endColumn: 8,
  }, [])).toBe('  |-- Long branch  \n\n  `-- Leaf\nAssociated Code Entities:');
});

it('copies a whole row when only one character is selected, without padding short rows', () => {
  const diagram = singleDiagramScene('Root\n  Leaf\n ').contents.overview;
  expect(selectionClipboardText(diagram, {
    startLine: 2, endLine: 3, startColumn: 5, endColumn: 5,
  }, [])).toBe('  Leaf\n \nAssociated Code Entities:');
  expect(selectionClipboardText(diagram, null, [])).toBeNull();
});
