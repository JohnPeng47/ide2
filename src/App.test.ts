import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { App } from './app/App';
vi.mock('./features/mapping/MappingPage', () => ({ MappingPocPage: () => createElement('main', null, 'Mapping workspace') }));
it('mounts Mapping directly without a Studio shell or browser routing dependency', () => {
  const markup = renderToStaticMarkup(createElement(App));
  expect(markup).toContain('<main>Mapping workspace</main>');
  expect(markup).toContain('aria-label="Switch to Neutral Light"');
});
