import { expect, it } from 'vitest';
import { comparisonOutputJsonSchema } from '../comparisonRuntime';
it('exports nested finding and scale unions using the strict runner schema vocabulary', () => {
  const schema = JSON.stringify(comparisonOutputJsonSchema(true));
  expect(schema).not.toContain('"oneOf"');
  expect(schema).not.toContain('"discriminator"');
  expect(schema).toContain('"anyOf"');
  expect(schema).toContain('"attributionConfidence"');
});
