import { expect, it } from 'vitest';
import { defaultTemplateSelection, findPromptTemplate, normalizePromptOptions, promptTemplateCatalog, renderPromptTemplate,
  resolvePromptTemplate, validateTemplateMarkdown } from '../promptTemplates';

it('ships valid catalog templates with defaults for each operation', () => {
  for (const template of promptTemplateCatalog) expect(validateTemplateMarkdown(template, template.markdown)).toEqual([]);
  expect(defaultTemplateSelection('edit-diagram')).toMatchObject({ id: 'edit-diagram/restructure', options: { style: 'balanced', detail: 3 } });
  expect(defaultTemplateSelection('create-diagram').id).toBe('create-diagram/overview');
});

it('reports missing required fields and unknown placeholders with their lines', () => {
  const template = findPromptTemplate('edit-diagram/annotate')!;
  expect(validateTemplateMarkdown(template, '{{context}}\n{{instruction}} {{options.style}}')).toEqual([
    { line: 2, message: '{{options.style}} is not a field or option of this template.' },
    { line: 0, message: '{{references}} is required.' }
  ]);
});

it('rejects unknown and out-of-range options instead of clamping them', () => {
  const template = findPromptTemplate('edit-diagram/restructure')!;
  expect(normalizePromptOptions(template, { detail: 5 })).toEqual({ style: 'balanced', detail: 5, maxNewNodes: 12 });
  expect(() => normalizePromptOptions(template, { detail: 6 })).toThrow('PROMPT_OPTION_INVALID: detail');
  expect(() => normalizePromptOptions(template, { style: 'loud' })).toThrow('PROMPT_OPTION_INVALID: style');
  expect(() => normalizePromptOptions(template, { tone: 'x' })).toThrow('PROMPT_OPTION_UNKNOWN: tone');
});

it('resolves edited Markdown for its own operation and renders option guidance', () => {
  const markdown = 'Style: {{options.style}} at {{options.detail}}\n{{context}} {{references}} {{instruction}}';
  const resolved = resolvePromptTemplate({ id: 'edit-diagram/restructure', version: 1, options: { style: 'minimal' }, markdown }, 'edit-diagram');
  expect(resolved.edited).toBe(true);
  expect(renderPromptTemplate({ ...resolved, parameters: resolved.definition.parameters }, { context: 'C', references: 'R', instruction: 'I' }))
    .toBe('Style: Use the fewest boxes and edges that still answer the instruction. at 3\nC R I');
  expect(() => resolvePromptTemplate({ id: 'edit-diagram/restructure', version: 1, options: {} }, 'create-diagram')).toThrow('PROMPT_TEMPLATE_OPERATION');
  expect(() => resolvePromptTemplate({ id: 'edit-diagram/restructure', version: 1, options: {}, markdown: '{{context}}' }, 'edit-diagram')).toThrow('PROMPT_TEMPLATE_INVALID');
  expect(() => resolvePromptTemplate({ id: 'missing', version: 1, options: {} }, 'edit-diagram')).toThrow('PROMPT_TEMPLATE_NOT_FOUND');
});
