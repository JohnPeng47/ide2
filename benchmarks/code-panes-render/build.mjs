// Replacement imports are resolved at their destination inside the app checkout.
export default {
  baseRef: 'working-tree',
  replacements: {
    'src/shared/source/SourceCodeView.tsx': './src/SourceCodeView.tsx',
  },
  build: ['npm', 'run', 'build', '--', '--sourcemap'],
  tests: ['./tests/correctness.mjs', './tests/performance.mjs'],
  parameters: { paneCounts: [1, 3, 5], trials: 3, steps: 60, width: 2400, height: 1500 },
};
