import { describe, expect, it } from 'vitest';
import { normalizePastedDiagram } from '../pasteDiagram';

describe('paste text normalization', () => {
  it('preserves indentation and blank rows while normalizing newlines and a code fence', () => {
    expect(normalizePastedDiagram('```text\r\n  Root\r\n  |-- Child\r\n\r\n```\r\n')).toBe('  Root\n  |-- Child\n');
    expect(normalizePastedDiagram('  Root\n\n')).toBe('  Root\n\n');
  });
  it.each(['', ' \r\n ', '```\n \n```', 'Root\tChild', 'Root\u0000', '─', 'x'.repeat(20001)])('rejects invalid clipboard case %#', text => {
    expect(() => normalizePastedDiagram(text)).toThrow();
  });
});
