import { expect, it } from 'vitest';
import type { PromptReference } from '../../../../../domain/mapping/agent/diagramEdit';
import { createPromptDraft, insertReference, insertReferenceWithCursor, maxPromptReferences, removeBlock, selectTemplate, serializePromptDraft,
  setBlockText, setCount, setTemplateMarkdown, setTemplateOption } from '../promptDraft';
import { diagramTitle, promptReferenceClipboard } from '../promptReferences';

const diagram = (revisionId: string): PromptReference => ({ kind: 'diagram', label: 'Checkout', diagramId: 'diagram-1', revisionId });
const nodes: PromptReference = { kind: 'nodes', label: 'PaymentService', diagramId: 'diagram-1', revisionId: 'diagram-revision-2',
  nodeIds: ['a:1'], range: { startLine: 2, endLine: 3, startColumn: 1, endColumn: 9 } };

it('splits text at the cursor and cites references in order', () => {
  let draft = createPromptDraft('edit-diagram');
  draft = setBlockText(draft, draft.body[0].id, 'Split  into two, like .');
  const first = insertReferenceWithCursor(draft, nodes, { blockId: draft.body[0].id, offset: 6 });
  draft = insertReference(first.draft, diagram('diagram-revision-1'), { blockId: first.draft.body[2].id, offset: 16 });
  expect(draft.body.map(block => block.kind)).toEqual(['text', 'reference', 'text', 'reference', 'text']);
  expect(serializePromptDraft(draft)).toEqual({ prompt: 'Split [ref 1] into two, like [ref 2].', references: [nodes, diagram('diagram-revision-1')] });
  expect(first.cursor).toEqual({ blockId: first.draft.body[2].id, offset: 0 });
});

it('keeps successive insertions in order and merges text when a reference is removed', () => {
  let draft = createPromptDraft('create-diagram'), cursor = { blockId: draft.body[0].id, offset: 0 };
  for (const revision of ['diagram-revision-a', 'diagram-revision-b']) ({ draft, cursor } = insertReferenceWithCursor(draft, diagram(revision), cursor));
  expect(serializePromptDraft(draft).references.map(reference => reference.revisionId)).toEqual(['diagram-revision-a', 'diagram-revision-b']);
  draft = setBlockText(draft, draft.body[2].id, ' and ');
  draft = removeBlock(draft, draft.body[1].id);
  expect(draft.body.map(block => block.kind)).toEqual(['text', 'reference', 'text']);
  expect(serializePromptDraft(draft).prompt).toBe('and [ref 1]');
  expect(removeBlock(draft, draft.body[0].id)).toEqual(draft);
});

it('appends with a stale cursor and caps references', () => {
  let draft = createPromptDraft('edit-diagram');
  draft = insertReference(draft, diagram('diagram-revision-1'), { blockId: 'gone', offset: 3 });
  expect(draft.body.map(block => block.kind)).toEqual(['text', 'reference', 'text']);
  for (let index = 1; index < maxPromptReferences; index++) draft = insertReference(draft, diagram(`diagram-revision-${index}`));
  expect(() => insertReference(draft, nodes)).toThrow(`at most ${maxPromptReferences}`);
});

it('resets options and Markdown when switching templates and drops Markdown equal to the template', () => {
  let draft = setTemplateOption(createPromptDraft('edit-diagram'), 'detail', 5);
  draft = setTemplateMarkdown(draft, 'custom {{context}} {{references}} {{instruction}}');
  expect(draft.template).toMatchObject({ options: { detail: 5 }, markdown: expect.stringContaining('custom') });
  draft = selectTemplate(draft, 'edit-diagram/annotate');
  expect(draft.template).toEqual({ id: 'edit-diagram/annotate', version: 1, options: { detail: 3 } });
  const definitionMarkdown = selectTemplate(draft, 'edit-diagram/restructure');
  expect(setTemplateMarkdown(definitionMarkdown, undefined).template.markdown).toBeUndefined();
  expect(setCount(draft, 9).count).toBe(4); expect(setCount(draft, 0).count).toBe(1);
});

it('encodes structured references in clipboard HTML with readable text', () => {
  const clipboard = promptReferenceClipboard([nodes, diagram('diagram-revision-1')]);
  expect(clipboard.text).toBe('[nodes: PaymentService in diagram-1] [diagram: Checkout]');
  expect(clipboard.html).toMatch(/^<span data-ide2-prompt-references="[A-Za-z0-9+/=]+">\[nodes: PaymentService/);
});

it('titles diagrams by their first line with words, ignoring box borders', () => {
  const title = (ascii: string) => diagramTitle({ id: 'fallback', content: { ascii } as never });
  expect(title('+------+----+\n| Checkout | Cart |\n+---v---+')).toBe('Checkout Cart');
  expect(title('Worker\n +-- task')).toBe('Worker');
  expect(title('+--+\n| v |')).toBe('fallback');
});
