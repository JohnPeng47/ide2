/** Minimal reconstruction of the wrapper/renamed-parent ChangeSession regression. */
export const floatingBefore = [
  'FloatingBox variants',
  '|-- DisplayNodeBase: pixel geometry + policies',
  '|   |-- expandedGeometry?',
  '|   `-- geometryPolicy',
  '|       |-- placement: automatic | manual',
  '|       `-- sizing: content | fixed',
  '`-- SelectionRegion',
].join('\n');

export const floatingAfter = [
  'FloatingBox variants',
  '`-- FloatingPane',
  '    |-- DisplayNodeBase',
  '    |   |-- pixel geometry / expansion',
  '    |   |-- expandedGeometry?',
  '    |   `-- geometryPolicy',
  '    |       |-- placement: automatic | manual',
  '    |       `-- sizing: content | fixed',
  '    `-- SelectionRegion',
].join('\n');
