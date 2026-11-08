import { expect, it } from 'vitest';
import { z } from 'zod';
import { linkedCanvasesOutputSchema } from './linkedCanvases';
import { linkedOutput } from '../../../tests/support/linkedCanvasOutput';

it('exports nested anyOf variants and closed, fully required objects for strict output', () => {
  // Exercise the same JSON export used by CodexEvalRuntime, not only Zod validation.
  const schema = JSON.parse(JSON.stringify(z.toJSONSchema(linkedCanvasesOutputSchema)));
  expect(schema.type).toBe('object');
  expect(schema.properties.canvases.items.anyOf).toHaveLength(2);
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const record = node as Record<string, unknown>;
    expect(record).not.toHaveProperty('oneOf');
    if (record.type === 'object') {
      expect(record.additionalProperties).toBe(false);
      expect([...(record.required as string[])].sort()).toEqual(Object.keys(record.properties as object).sort());
    }
    Object.values(record).forEach(visit);
  };
  visit(schema);
});

it('accepts both canvas variants while rejecting mixed and unknown variants', () => {
  const output = linkedOutput();
  expect(linkedCanvasesOutputSchema.safeParse(output).success).toBe(true);
  const existing = { kind: 'existing', id: 'root', sourceCanvas: 'c1', edits: [] };
  const withCanvas = (canvas: unknown) => ({ ...output, canvases: [output.canvases[0], canvas] });
  expect(linkedCanvasesOutputSchema.safeParse(withCanvas(existing)).success).toBe(true);
  expect(linkedCanvasesOutputSchema.safeParse(withCanvas({ ...existing, name: 'Mixed' })).success).toBe(false);
  expect(linkedCanvasesOutputSchema.safeParse(withCanvas({ ...existing, kind: 'unknown' })).success).toBe(false);
});
