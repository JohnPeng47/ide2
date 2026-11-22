import { expect, it } from 'vitest';
import { defaultPromptTemplateBase as base, emptyPromptStructure, legacyPromptTemplateBase, parsePromptSections, promptTemplateBaseSchema, renderPromptSections, structurePrompt } from './promptTemplateBase';
it('preserves generic types in examples without capturing them as structural tags', () => {
  const text = '<task>Inspect code.</task>\nqueue: BoundedQueue<AcceptedBatch>\nMap<Key, Value>\n<output format>Return JSON.</output format>';
  const captured = promptTemplateBaseSchema.parse(legacyPromptTemplateBase({ alternative: text }));
  expect(parsePromptSections(text, captured).issues).toEqual([]);
  expect(renderPromptSections(text, captured)).toBe(text);
  expect(captured.tags.some(tag => tag.name === 'AcceptedBatch')).toBe(false);
  expect(parsePromptSections('<Unknown>text</Unknown>', captured).issues.length).toBeGreaterThan(0);
});
it('omits recursively empty tags and preserves populated text exactly', () => {
  const text = '<diagram-style>\n<diagram-guidelines> </diagram-guidelines><references>\n</references></diagram-style>\n<task>Keep this.</task>';
  expect(renderPromptSections(text, base)).toBe('\n<task>Keep this.</task>');
  expect(renderPromptSections(emptyPromptStructure, base)).not.toContain('diagram-style');
});
it('rejects unknown, incorrectly nested and unbalanced tags with source locations', () => {
  for (const text of ['<unknown>x</unknown>', '<references>x</references>', '<task>x</canvas-style>', '<task>x']) expect(parsePromptSections(text, base).issues[0]).toMatchObject({ severity: 'error', start: expect.any(Number) });
  expect(parsePromptSections('<diagram-style><references>A</references></diagram-style><canvas-style><references>B</references></canvas-style>',base).issues).toEqual([]);
});
it('adapts existing instructions while initializing both styles empty', () => {
 const text = structurePrompt('<agent context>Read context.json.</agent context>\nDo work.\n<output format>Return JSON.</output format>');
 expect(parsePromptSections(text,base).issues).toEqual([]);
 expect(renderPromptSections(text,base)).toContain('<task>\nDo work.\n</task>');
 expect(renderPromptSections(text,base)).not.toContain('canvas-style');
});

it('omits sections emptied by substitutions without interpreting tags inside substituted evidence', async () => {
 const { composePrompt, evalWorkflows } = await import('./evalWorkflows');
 expect(composePrompt(evalWorkflows.alternatives, 'alternative', '<diagram-style><references>{{references}}</references></diagram-style><task>{{context}}</task>', { references: '', context: '<source-code>literal</source-code>' }, base)).toBe('<task><source-code>literal</source-code></task>');
});
