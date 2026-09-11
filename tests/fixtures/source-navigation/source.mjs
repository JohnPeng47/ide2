export const mathSource = 'export function double(value: number) { return value * 2; }\n';
export const mainSource = [
  'import { double } from "./math";',
  'import { context12 } from "./large";',
  'const emoji = "😀"; double(21);',
  'function local() { return 1; }',
  'local();',
  'context12(3);',
  ...Array.from({ length: 100 }, () => '')
].join('\n');
export const tsconfig = { compilerOptions: { strict: true }, include: ['src/**/*.ts'] };
