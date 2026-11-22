import { expect, it } from 'vitest';
import { validateDiagramLocalMappings } from '../../core/diagrams/diagramMappings';
import { contentFields, sourceMappingsFields } from './contracts';

it('accepts more than 2,000 ranges on one diagram and validates the last mapping', () => {
  const mappings = Array.from({ length: 3_098 }, (_, i) => ({
    id: String(i), entityId: 'entity', sourceRangeIndex: i, line: 1, startColumn: 1, endColumn: 1,
  }));
  expect(contentFields.mappings.safeParse(mappings).success).toBe(true);
  expect(sourceMappingsFields.mappings.safeParse(mappings).success).toBe(true);
  expect(() => validateDiagramLocalMappings('A', mappings)).not.toThrow();

  mappings[mappings.length - 1].endColumn = 2;
  expect(() => validateDiagramLocalMappings('A', mappings)).toThrow('Invalid diagram-local source mapping');
});
