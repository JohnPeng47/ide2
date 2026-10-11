import type { PromptReference } from '../../../../domain/mapping/agent/diagramEdit';
import { defaultOptions, defaultTemplateSelection, findPromptTemplate, type PromptOperation, type PromptOptionValue, type PromptTemplateSelection } from '../../../../domain/mapping/agent/promptTemplates';

export type PromptBlock = { kind: 'text'; id: string; text: string } | { kind: 'reference'; id: string; reference: PromptReference };
/**
 * The template is a separate field, so nothing can be inserted before it or delete it.
 * The body alternates text and references and always starts and ends with text (possibly empty).
 */
export interface PromptDraft { template: PromptTemplateSelection; body: readonly PromptBlock[]; count: number }
export interface PromptCursor { blockId: string; offset: number }
export const maxPromptReferences = 20;
export const maxPromptCount = 4;

const textBlock = (text = ''): PromptBlock => ({ kind: 'text', id: crypto.randomUUID(), text });
export function createPromptDraft(operation: PromptOperation): PromptDraft {
  return { template: defaultTemplateSelection(operation), body: [textBlock()], count: 1 };
}

/** Merge adjacent text and keep a text block between references and at both ends. */
function normalize(body: readonly PromptBlock[]): PromptBlock[] {
  const result: PromptBlock[] = [];
  for (const block of body) {
    const last = result.at(-1);
    if (block.kind === 'text' && last?.kind === 'text') result[result.length - 1] = { ...last, text: last.text + block.text };
    else { if (block.kind === 'reference' && last?.kind !== 'text') result.push(textBlock()); result.push(block); }
  }
  if (result.at(-1)?.kind !== 'text') result.push(textBlock());
  if (result[0]?.kind !== 'text') result.unshift(textBlock());
  return result;
}
export const draftReferences = (draft: PromptDraft) => draft.body.flatMap(block => block.kind === 'reference' ? [block.reference] : []);

/** Insert at the cursor, splitting its text; without a cursor (or a stale one) append at the end. */
export function insertReference(draft: PromptDraft, reference: PromptReference, cursor?: PromptCursor): PromptDraft {
  return insertReferenceWithCursor(draft, reference, cursor).draft;
}
/** Also returns the caret just after the new chip, so successive insertions keep their order. */
export function insertReferenceWithCursor(draft: PromptDraft, reference: PromptReference, cursor?: PromptCursor): { draft: PromptDraft; cursor: PromptCursor } {
  if (draftReferences(draft).length >= maxPromptReferences) throw Error(`A prompt can hold at most ${maxPromptReferences} references.`);
  const index = cursor ? draft.body.findIndex(block => block.id === cursor.blockId && block.kind === 'text') : -1;
  const chip: PromptBlock = { kind: 'reference', id: crypto.randomUUID(), reference: structuredClone(reference) };
  let body: PromptBlock[];
  if (index < 0) body = normalize([...draft.body, chip]);
  else {
    const block = draft.body[index] as Extract<PromptBlock, { kind: 'text' }>;
    const offset = Math.max(0, Math.min(block.text.length, cursor!.offset));
    body = normalize([...draft.body.slice(0, index), { ...block, text: block.text.slice(0, offset) },
      chip, textBlock(block.text.slice(offset)), ...draft.body.slice(index + 1)]);
  }
  return { draft: { ...draft, body }, cursor: { blockId: body[body.findIndex(block => block.id === chip.id) + 1].id, offset: 0 } };
}
export function removeBlock(draft: PromptDraft, blockId: string): PromptDraft {
  return { ...draft, body: normalize(draft.body.filter(block => block.id !== blockId || block.kind === 'text')) };
}
export function setBlockText(draft: PromptDraft, blockId: string, text: string): PromptDraft {
  return { ...draft, body: draft.body.map(block => block.id === blockId && block.kind === 'text' ? { ...block, text } : block) };
}
/** Switching templates resets options and edited Markdown: neither carries meaning across templates. */
export function selectTemplate(draft: PromptDraft, templateId: string, version?: number): PromptDraft {
  const definition = findPromptTemplate(templateId, version);
  if (!definition) return draft;
  return { ...draft, template: { id: definition.id, version: definition.version, options: defaultOptions(definition) } };
}
export function setTemplateOption(draft: PromptDraft, key: string, value: PromptOptionValue): PromptDraft {
  return { ...draft, template: { ...draft.template, options: { ...draft.template.options, [key]: value } } };
}
export function setTemplateMarkdown(draft: PromptDraft, markdown: string | undefined): PromptDraft {
  const definition = findPromptTemplate(draft.template.id, draft.template.version);
  const { markdown: _, ...template } = draft.template;
  return { ...draft, template: markdown === undefined || markdown === definition?.markdown ? template : { ...template, markdown } };
}
export function setCount(draft: PromptDraft, count: number): PromptDraft {
  return { ...draft, count: Math.max(1, Math.min(maxPromptCount, Math.round(count))) };
}

export function referenceSummary(reference: PromptReference) {
  return reference.kind === 'diagram' ? reference.label : `${reference.label} · ${reference.nodeIds.length || 'region'}${reference.nodeIds.length === 1 ? ' node' : reference.nodeIds.length ? ' nodes' : ''}`;
}
/** Body text with each reference cited in order as [ref N]; references[N-1] is its pinned target. */
export function serializePromptDraft(draft: PromptDraft): { prompt: string; references: PromptReference[] } {
  const references: PromptReference[] = [];
  const prompt = draft.body.map(block => {
    if (block.kind === 'text') return block.text;
    references.push(structuredClone(block.reference));
    return `[ref ${references.length}]`;
  }).join('').trim();
  return { prompt, references };
}
