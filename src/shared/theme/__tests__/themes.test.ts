import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { tokenizeSource } from '../../source/sourceHighlighting';
import { renderTerminalMarkdownFragment } from '../../markdown/render';

it('provides the same complete semantic contract for dark and light themes', () => {
  const css = readFileSync(new URL('../../../app/styles/themes.css', import.meta.url), 'utf8');
  const [dark, light] = css.split(':root[data-theme="light"]');
  const names = (block: string) => [...block.matchAll(/(--[\w-]+):/g)].map(match => match[1]).sort();
  expect(names(light)).toEqual(names(dark));
  expect(names(light)).toContain('--surface-canvas');
  expect(names(light)).toContain('--diff-added-text');
});

it('keeps source syntax caches separate for light and dark themes', async () => {
  const source = 'const count: number = 42;';
  const [dark, light] = await Promise.all([tokenizeSource('a.ts', source, 'dark'), tokenizeSource('a.ts', source, 'light')]);
  expect(dark.bg).not.toBe(light.bg);
  expect(dark.fg).not.toBe(light.fg);
  expect(dark.tokens.flat().map(token => token.content).join('')).toBe(source);
  expect(light.tokens.flat().map(token => token.content).join('')).toBe(source);
  expect(await tokenizeSource('a.ts', source, 'dark')).toBe(dark);
});

it('renders embedded markdown code with the selected theme', async () => {
  const source = '```ts\nconst count = 42;\n```';
  const [dark, light] = await Promise.all([renderTerminalMarkdownFragment(source), renderTerminalMarkdownFragment(source, '', 0, 'light')]);
  expect(dark).toContain('catppuccin-mocha');
  expect(light).toContain('catppuccin-latte');
  expect(light).not.toBe(dark);
});
