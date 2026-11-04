import { expect, it } from 'vitest';
import { renderTemplate, templateVariables, tokenizeTemplate, validateTemplate } from '../promptTemplate';
import { composePrompt, evalWorkflows, validatePromptStages } from '../evalWorkflows';

const variables = [{ name: 'child' }, { name: 'pass' }];
it('tokenizes placeholders with offsets and renders values', () => {
  const body = 'Roll {{ child }} up, pass {{pass}}.';
  expect(tokenizeTemplate(body).filter(t => t.kind === 'variable').map(t => [t.name, body.slice(t.start, t.end)])).toEqual([['child', '{{ child }}'], ['pass', '{{pass}}']]);
  expect(templateVariables(body)).toEqual(['child', 'pass']);
  expect(renderTemplate(body, { child: '"A"', pass: '2' })).toBe('Roll "A" up, pass 2.');
  expect(() => renderTemplate(body, { child: 'A' })).toThrow('Missing value for {{pass}}');
});
it('reports unknown, invalid and unclosed placeholders with ranges', () => {
  const issues = validateTemplate('{{parent}} {{Bad-name}} {{child', variables);
  expect(issues.map(i => [i.severity, i.message.split(' ')[0]])).toEqual([['error', 'Unknown'], ['error', 'Invalid'], ['warning', 'Unclosed']]);
  expect(issues[0]).toMatchObject({ start: 0, end: 10 });
  expect(validateTemplate('  ', variables)[0].message).toBe('The prompt is empty.');
});
it('sends only the visible prompt and rejects removed task placeholders', () => {
  const workflow = evalWorkflows['roll-up'];
  expect(Object.values(validatePromptStages(workflow, workflow.defaultPrompt.stages)).flat()).toEqual([]);
  const prompt = composePrompt(workflow, 'g2', 'Body {{pass}}', { pass: '3' });
  expect(prompt).toBe('Body 3');
  expect(workflow.defaultPrompt.stages.g2).toContain(workflow.stages[1].contextHeader);
  expect(workflow.defaultPrompt.stages.g2).toContain(workflow.stages[1].outputFormat);
  expect(validatePromptStages(evalWorkflows.alternatives, { alternative: '{{task}}' }).alternative[0].message).toContain('Unknown variable');
  expect(validatePromptStages(workflow, { r2: 'x' }).g2[0].message).toBe('The prompt is empty.');
});

it('accepts nested JSON output examples as literal prompt text', () => {
  expect(validateTemplate('Return {position:{column,row}}.', [])).toEqual([]);
});
