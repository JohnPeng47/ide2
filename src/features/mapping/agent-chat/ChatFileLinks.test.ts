import { expect, it } from 'vitest';
import { chatFileTarget } from './ChatFileLinks';
it('resolves project file references and line anchors without allowing outside paths or URI schemes', () => {
  expect(chatFileTarget('/repo/src/a.ts:12:3', '/repo')).toEqual({ path: 'src/a.ts', line: 12 });
  expect(chatFileTarget('file:///repo/src/a%20b.ts#L9', '/repo')).toEqual({ path: 'src/a b.ts', line: 9 });
  expect(chatFileTarget('./README.md', '/repo')).toEqual({ path: 'README.md', line: 1 });
  for (const href of ['/other/a.ts', '/repository/a.ts', '../secret', 'src/../secret', 'https://example.com', 'javascript:alert(1)', '%broken']) expect(chatFileTarget(href, '/repo')).toBeUndefined();
});
