// Deterministic large source shared by the five independently scrollable viewers.
export const sourceText = Array.from({ length: 3000 }, (_, index) => index === 2999
  ? `export const wideLine = ${JSON.stringify('x'.repeat(240))};`
  : `export function context${index + 1}(value: number) { return value * ${index + 1} + 1; }`).join('\n');
