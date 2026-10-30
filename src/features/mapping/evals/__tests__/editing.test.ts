import { expect, it } from 'vitest';
import { canRedo, createHistory, record, redo, undo } from '../editHistory';
import { duplicateLines, indent, moveLines, outdent } from '../textEdits';

const sel = (start: number, end = start) => ({ start, end });
it('coalesces quick typing per stage and restores values, stages and carets', () => {
  let h = createHistory({ r2: '', g2: '' }, 'r2');
  h = record(h, { value: { r2: 'a', g2: '' }, scope: 'r2', before: sel(0), after: sel(1), kind: 'type' }, 1000);
  h = record(h, { value: { r2: 'ab', g2: '' }, scope: 'r2', before: sel(1), after: sel(2), kind: 'type' }, 1500);
  h = record(h, { value: { r2: 'ab', g2: 'x' }, scope: 'g2', before: sel(0), after: sel(1), kind: 'type' }, 1600);
  h = record(h, { value: { r2: 'ab{{pass}}', g2: 'x' }, scope: 'r2', before: sel(2), after: sel(10), kind: 'command' }, 1700);
  expect(h.entries).toHaveLength(4);
  let step = undo(h)!; expect(step).toMatchObject({ value: { r2: 'ab', g2: 'x' }, scope: 'r2', selection: sel(2) });
  step = undo(step.history)!; expect(step).toMatchObject({ value: { r2: 'ab', g2: '' }, scope: 'g2', selection: sel(0) });
  step = undo(step.history)!; expect(step).toMatchObject({ value: { r2: '', g2: '' }, scope: 'r2', selection: sel(0) });
  expect(undo(step.history)).toBeUndefined();
  const again = redo(step.history)!; expect(again).toMatchObject({ value: { r2: 'ab', g2: '' }, selection: sel(2) });
  // Typing after undo drops the redo branch and never merges into the restored entry.
  const branched = record(again.history, { value: { r2: 'abc', g2: '' }, scope: 'r2', before: sel(2), after: sel(3), kind: 'type' }, 1550);
  expect(canRedo(branched)).toBe(false); expect(branched.entries).toHaveLength(3);
  expect(record(h, { value: { r2: 'z', g2: 'x' }, scope: 'r2', before: sel(0), after: sel(1), kind: 'type' }, 9000).entries).toHaveLength(5);
});
it('indents and outdents lines while keeping the selection on the same text', () => {
  expect(indent('ab', sel(1))).toEqual({ value: 'a  b', selection: sel(3) });
  expect(indent('one\ntwo\nthree', sel(1, 6))).toEqual({ value: '  one\n  two\nthree', selection: sel(3, 10) });
  // A selection ending at a line start leaves that line alone.
  expect(indent('one\ntwo', sel(0, 4)).value).toBe('  one\ntwo');
  expect(outdent('  one\n two\nthree', sel(0, 16))).toEqual({ value: 'one\ntwo\nthree', selection: sel(0, 13) });
  expect(outdent('\tx', sel(2))).toEqual({ value: 'x', selection: sel(1) });
  expect(outdent('  ab', sel(1)).selection).toEqual(sel(0));
});
it('moves and duplicates line blocks', () => {
  expect(moveLines('a\nbb\nc', sel(3), -1)).toEqual({ value: 'bb\na\nc', selection: sel(1) });
  expect(moveLines('a\nbb\nc', sel(3), 1)).toEqual({ value: 'a\nc\nbb', selection: sel(5) });
  expect(moveLines('a\nb', sel(0), -1)).toBeUndefined();
  expect(moveLines('a\nb', sel(2), 1)).toBeUndefined();
  expect(duplicateLines('a\nbb', sel(3), 1)).toEqual({ value: 'a\nbb\nbb', selection: sel(6) });
  expect(duplicateLines('a\nbb', sel(3), -1)).toEqual({ value: 'a\nbb\nbb', selection: sel(3) });
});
