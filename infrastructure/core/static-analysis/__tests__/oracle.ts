import type { AnalysisEntity, AnalysisRelation, AnalysisView } from '../../../../domain/core/static-analysis/schema';

export interface EntitySelector {
  path?: string;
  name?: string;
  kind?: AnalysisEntity['kind'];
  anchor?: string;
  metadata?: Partial<AnalysisEntity['metadata']>;
}
export interface ExpectedFact {
  label: string;
  view: AnalysisView;
  kind: AnalysisRelation['kind'];
  from: EntitySelector;
  to: EntitySelector;
  status?: AnalysisRelation['provenance']['status'];
  access?: ('read' | 'reassign' | 'object-mutate')[];
  depth?: 'binding' | 'shallow' | 'deep' | 'unknown';
  mechanism?: string;
  typeOnly?: boolean;
  dispatch?: string;
  propertyPath?: string[];
  at?: string;
}
export interface Oracle {
  verification: { method: 'manual-source-inspection'; author: string; date: string; rationale: string };
  mustContain: ExpectedFact[];
  mustNotContain: ExpectedFact[];
  uncertainties: { view: AnalysisView; reason: string; at?: string }[];
}
export const manual = (rationale: string): Oracle['verification'] => ({ method: 'manual-source-inspection',
  author: 'Codex (source reasoning, independent of analyzer output; not human-reviewed)', date: '2026-10-31', rationale });

export const fixtureOracles: Record<string, Oracle> = {
  'branch-explosion': { verification: manual('Twenty independent conditions represent over one million possible paths in a small AST. Analyze joins/definitions without enumerating execution paths.'), mustContain: [
    { label: 'closure captures merged mutable binding', view: 'lexical', kind: 'captures', from: { name: 'read' }, to: { name: 'value' }, access: ['read'] },
    { label: 'entry calls returned-value closure', view: 'calls', kind: 'calls', from: { name: 'diamonds' }, to: { name: 'read' } },
    { label: 'last conditional write retains control dependency', view: 'dependencies', kind: 'control', from: { name: 'flags', kind: 'parameter' }, to: { name: 'value', kind: 'definition', anchor: 'value += 20' } },
  ], mustNotContain: [
    { label: 'reader does not reassign captured state', view: 'lexical', kind: 'captures', from: { name: 'read' }, to: { name: 'value' }, access: ['reassign'] },
  ], uncertainties: [] },
  'def-use': { verification: manual('The second value definition kills the first; branched chosen merges two reaching definitions; destructuring carries only the selected input property.'), mustContain: [
    { label: 'return uses last reaching definition', view: 'dependencies', kind: 'return', from: { kind: 'definition', name: 'value', anchor: 'value = 2' }, to: { name: 'overwritten', kind: 'function' } },
    { label: 'branch controls conditional write', view: 'dependencies', kind: 'control', from: { name: 'flag', kind: 'parameter' }, to: { name: 'chosen', kind: 'definition', anchor: 'chosen = 2' } },
    { label: 'return depends on merged definitions', view: 'dependencies', kind: 'return', from: { name: 'chosen', kind: 'merge' }, to: { name: 'branched', kind: 'function' } },
    { label: 'destructuring carries input value', view: 'dependencies', kind: 'value-flow', from: { name: 'input', kind: 'parameter' }, to: { name: 'renamed', kind: 'binding' }, propertyPath: ['left'] },
  ], mustNotContain: [
    { label: 'killed definition cannot reach return', view: 'dependencies', kind: 'return', from: { kind: 'definition', name: 'value', anchor: 'value = 1' }, to: { name: 'overwritten', kind: 'function' } },
    { label: 'unused property does not flow into destructuring', view: 'dependencies', kind: 'value-flow', from: { name: 'input', kind: 'parameter' }, to: { name: 'renamed', kind: 'binding' }, propertyPath: ['right'] },
  ], uncertainties: [] },
  shadowing: { verification: manual('Each closure resolves value in its own lexical environment; equal identifier text is not equal identity.'), mustContain: [
    { label: 'outer closure captures module value', view: 'lexical', kind: 'captures', from: { name: 'readOuter' }, to: { name: 'value', anchor: 'value = 1' }, access: ['read'] },
    { label: 'inner closure captures block value', view: 'lexical', kind: 'captures', from: { name: 'readInner' }, to: { name: 'value', anchor: 'value = 2' }, access: ['read'] },
    { label: 'outer invokes inner closure', view: 'calls', kind: 'calls', from: { name: 'outer' }, to: { name: 'readInner' }, dispatch: 'direct' },
  ], mustNotContain: [
    { label: 'inner does not capture module value', view: 'lexical', kind: 'captures', from: { name: 'readInner' }, to: { name: 'value', anchor: 'value = 1' } },
  ], uncertainties: [] },
  hoisting: { verification: manual('var is function-scoped even though its declaration is inside the if block; let remains block-scoped.'), mustContain: [
    { label: 'function scope declares var', view: 'lexical', kind: 'declares', from: { kind: 'scope', anchor: 'if (flag)', metadata: { scopeKind: 'function' } }, to: { name: 'shared', metadata: { bindingKind: 'var' } } },
    { label: 'block scope declares let', view: 'lexical', kind: 'declares', from: { kind: 'scope', metadata: { scopeKind: 'block' } }, to: { name: 'local', metadata: { bindingKind: 'let' } } },
    { label: 'returned closure captures var', view: 'lexical', kind: 'captures', from: { name: 'read' }, to: { name: 'shared' }, access: ['read'] },
  ], mustNotContain: [
    { label: 'returned closure does not capture unused block local', view: 'lexical', kind: 'captures', from: { name: 'read' }, to: { name: 'local' } },
  ], uncertainties: [] },
  'captured-cell': { verification: manual('previous += 1 reads and reassigns the captured binding; state.count += 1 mutates the object but does not reassign const state.'), mustContain: [
    { label: 'mutable lexical cell', view: 'lexical', kind: 'captures', from: { name: 'tick' }, to: { name: 'previous' }, access: ['read', 'reassign'] },
    { label: 'const object remains mutable', view: 'lexical', kind: 'captures', from: { name: 'tick' }, to: { name: 'state' }, access: ['object-mutate'] },
    { label: 'write is attributed to tick', view: 'dependencies', kind: 'writes', from: { name: 'tick' }, to: { name: 'state' } },
  ], mustNotContain: [
    { label: 'const object mutation is not binding reassignment', view: 'lexical', kind: 'captures', from: { name: 'tick' }, to: { name: 'state' }, access: ['reassign'] },
    { label: 'numeric reassignment is not object mutation', view: 'lexical', kind: 'captures', from: { name: 'tick' }, to: { name: 'previous' }, access: ['object-mutate'] },
    { label: 'read closure is not a writer', view: 'dependencies', kind: 'writes', from: { name: 'read' }, to: { name: 'state' } },
  ], uncertainties: [] },
  'alias-escape': { verification: manual('alias and state reference the same allocation. opaque has no implementation; passing it the object is an escape, not proof of purity.'), mustContain: [
    { label: 'local alias points to state binding', view: 'ownership', kind: 'aliases', from: { name: 'alias' }, to: { name: 'state' } },
    { label: 'writer can mutate aliased state', view: 'ownership', kind: 'can-mutate', from: { name: 'write' }, to: { name: 'state' } },
    { label: 'write propagates through alias', view: 'dependencies', kind: 'writes', from: { name: 'write' }, to: { name: 'state' } },
    { label: 'closure captures alias', view: 'lexical', kind: 'captures', from: { name: 'write' }, to: { name: 'alias' }, access: ['object-mutate'] },
    { label: 'call through local function alias', view: 'calls', kind: 'calls', from: { name: 'aliases' }, to: { name: 'write' }, at: 'invoke()' },
  ], mustNotContain: [
    { label: 'alias is not a second allocation', view: 'ownership', kind: 'creates', from: { name: 'alias' }, to: { kind: 'allocation' } },
  ], uncertainties: [{ view: 'ownership', reason: 'escaped-reference', at: 'opaque(alias)' }] },
  recursion: { verification: manual('even and odd form one SCC; countdown has a self-edge. A source call graph is not forced into a tree.'), mustContain: [
    { label: 'even to odd', view: 'calls', kind: 'calls', from: { name: 'even' }, to: { name: 'odd' }, status: 'resolved' },
    { label: 'odd to even', view: 'calls', kind: 'calls', from: { name: 'odd' }, to: { name: 'even' }, status: 'resolved' },
    { label: 'self recursion', view: 'calls', kind: 'calls', from: { name: 'countdown' }, to: { name: 'countdown' }, status: 'resolved' },
  ], mustNotContain: [
    { label: 'unrelated recursion families stay separate', view: 'calls', kind: 'calls', from: { name: 'even' }, to: { name: 'countdown' } },
  ], uncertainties: [] },
  dispatch: { verification: manual('The local union has A.run and B.run as candidates. Runner and callbacks[key] cannot be reduced to one known implementation.'), mustContain: [
    { label: 'union candidate A', view: 'calls', kind: 'calls', from: { name: 'dispatch' }, to: { name: 'run', anchor: 'return 1' }, status: 'inferred' },
    { label: 'union candidate B', view: 'calls', kind: 'calls', from: { name: 'dispatch' }, to: { name: 'run', anchor: 'return 2' }, status: 'inferred' },
  ], mustNotContain: [
    { label: 'interface call is not certainly A', view: 'calls', kind: 'calls', from: { name: 'dispatch' }, to: { name: 'run', anchor: 'return 1' }, status: 'resolved', at: 'unknown.run()' },
  ], uncertainties: [{ view: 'calls', reason: 'dynamic-dispatch', at: 'unknown.run()' }, { view: 'calls', reason: 'computed-key', at: 'callbacks[key]()' }] },
  imports: { verification: manual('advance resolves through a value re-export to increment. Shape is type-only and never a runtime call or value flow.'), mustContain: [
    { label: 're-exported function target', view: 'calls', kind: 'calls', from: { name: 'use' }, to: { name: 'increment' }, status: 'resolved' },
    { label: 'type-only import preserved', view: 'containment', kind: 'imports', from: { kind: 'module', path: 'application/core/use.ts' }, to: { kind: 'module', path: 'domain/core/barrel.ts' }, typeOnly: true },
    { label: 'cross-layer shared state read', view: 'dependencies', kind: 'reads', from: { name: 'state', path: 'domain/core/value.ts' }, to: { name: 'use' } },
  ], mustNotContain: [
    { label: 'type-only import is not executed', view: 'calls', kind: 'calls', from: { name: 'use' }, to: { name: 'Shape' } },
    { label: 'type annotation is not data flow', view: 'dependencies', kind: 'value-flow', from: { name: 'Shape' }, to: { name: 'use' } },
  ], uncertainties: [] },
  'this-capture': { verification: manual('Arrow inherits Counter.start this; ordinary function has its own explicitly typed dynamic receiver.'), mustContain: [
    { label: 'arrow captures receiver', view: 'lexical', kind: 'captures-this', from: { name: 'arrow' }, to: { name: 'this' }, access: ['object-mutate'] },
    { label: 'arrow passed to opaque registrar', view: 'calls', kind: 'calls', from: { name: 'start' }, to: { name: 'register' } },
  ], mustNotContain: [
    { label: 'ordinary function does not capture outer this', view: 'lexical', kind: 'captures-this', from: { name: 'ordinary' }, to: { name: 'this' } },
    { label: 'callback registration is not immediate invocation', view: 'calls', kind: 'calls', from: { name: 'start' }, to: { name: 'arrow' }, status: 'resolved' },
  ], uncertainties: [{ view: 'calls', reason: 'external-body', at: 'register(arrow)' }] },
  'async-state': { verification: manual('refresh mutates its object parameter after await; the subscription callback captures it; returning off retains cleanup capability.'), mustContain: [
    { label: 'awaited loader', view: 'calls', kind: 'calls', from: { name: 'refresh' }, to: { name: 'load' } },
    { label: 'parameter write', view: 'dependencies', kind: 'writes', from: { name: 'refresh' }, to: { name: 'state' } },
    { label: 'async callback retains mutation capability', view: 'ownership', kind: 'can-mutate', from: { kind: 'function', anchor: 'state.value = value' }, to: { name: 'state' } },
    { label: 'callback mutates captured parameter', view: 'lexical', kind: 'captures', from: { kind: 'function', anchor: 'state.value = value' }, to: { name: 'state' }, access: ['object-mutate'] },
    { label: 'cleanup closes over unsubscribe handle', view: 'lexical', kind: 'captures', from: { kind: 'function', anchor: '() => off()' }, to: { name: 'off' }, access: ['read'] },
  ], mustNotContain: [
    { label: 'static analysis does not invent observed calls', view: 'calls', kind: 'calls', from: { name: 'refresh' }, to: { name: 'load' }, status: 'observed' },
  ], uncertainties: [{ view: 'calls', reason: 'external-body', at: 'load()' }] },
  'react-props': { verification: manual('Panel composes Button via JSX. Effect captures latest and onChange but lists only onChange. Setter is passed through a handler and props.'), mustContain: [
    { label: 'JSX composition', view: 'containment', kind: 'jsx-child', from: { name: 'Panel' }, to: { name: 'Button' } },
    { label: 'effect captures ref', view: 'lexical', kind: 'captures', from: { kind: 'function', anchor: '() => { onChange(latest.current); }' }, to: { name: 'latest' }, access: ['read'] },
    { label: 'declared effect dependency', view: 'dependencies', kind: 'effect-dependency', from: { name: 'onChange' }, to: { kind: 'function', anchor: '() => { onChange(latest.current); }' }, mechanism: 'react' },
    { label: 'prop carries handler', view: 'dependencies', kind: 'prop-flow', from: { name: 'press' }, to: { name: 'onPress' }, mechanism: 'react' },
    { label: 'handler closes over parent callback', view: 'lexical', kind: 'captures', from: { name: 'press' }, to: { name: 'onChange' }, access: ['read'] },
    { label: 'state setter grants mutation capability', view: 'ownership', kind: 'can-mutate', from: { name: 'press' }, to: { name: 'value', path: 'input.tsx' } },
    { label: 'unknown callback invocation retains explicit target', view: 'calls', kind: 'calls', from: { name: 'click' }, to: { name: 'onPress', kind: 'parameter' }, dispatch: 'callback' },
  ], mustNotContain: [
    { label: 'JSX is not a direct function call', view: 'calls', kind: 'calls', from: { name: 'Panel' }, to: { name: 'Button' }, status: 'resolved' },
    { label: 'capture is not an invented dependency array entry', view: 'dependencies', kind: 'effect-dependency', from: { name: 'latest' }, to: { kind: 'function', anchor: '() => { onChange(latest.current); }' } },
  ], uncertainties: [] },
  'reactive-cycle': { verification: manual('A store notification drives an atom, whose computed value is used to write back to the store. The aggregate relation graph may cycle.'), mustContain: [
    { label: 'computed reads atom', view: 'dependencies', kind: 'reads', from: { name: 'mirror' }, to: { kind: 'function', anchor: '() => mirror.get() * 2' }, mechanism: 'tldraw' },
    { label: 'callback writes mirror', view: 'dependencies', kind: 'writes', from: { kind: 'function', anchor: 'mirror.set(state.count)' }, to: { name: 'mirror' }, mechanism: 'tldraw' },
    { label: 'callback writes store', view: 'dependencies', kind: 'writes', from: { kind: 'function', anchor: 'mirror.set(state.count)' }, to: { name: 'store' }, mechanism: 'zustand' },
    { label: 'store read', view: 'dependencies', kind: 'reads', from: { name: 'store' }, to: { name: 'selectCount' }, mechanism: 'zustand' },
    { label: 'cyclic subscriber captures store', view: 'lexical', kind: 'captures', from: { kind: 'function', anchor: 'mirror.set(state.count)' }, to: { name: 'store' }, access: ['read'] },
    { label: 'cyclic subscriber can mutate store', view: 'ownership', kind: 'can-mutate', from: { kind: 'function', anchor: 'mirror.set(state.count)' }, to: { name: 'store' } },
  ], mustNotContain: [
    { label: 'read-only selector is not a writer', view: 'dependencies', kind: 'writes', from: { name: 'selectCount' }, to: { name: 'store' } },
  ], uncertainties: [] },
  'cross-layer': { verification: manual('The application closure retains imported domain state. Domain notification calls an application callback through a Set; do not infer one direct target from spelling.'), mustContain: [
    { label: 'cross-layer direct call', view: 'calls', kind: 'calls', from: { name: 'service' }, to: { name: 'write' } },
    { label: 'imported state capture', view: 'lexical', kind: 'captures', from: { name: 'callback' }, to: { name: 'state' }, access: ['read'] },
    { label: 'cross-layer data read', view: 'dependencies', kind: 'reads', from: { name: 'state' }, to: { name: 'callback' } },
    { label: 'callback retains onValue', view: 'lexical', kind: 'captures', from: { name: 'callback' }, to: { name: 'onValue' }, access: ['read'] },
    { label: 'application mutates imported listener collection', view: 'ownership', kind: 'can-mutate', from: { name: 'service' }, to: { name: 'listeners' } },
  ], mustNotContain: [
    { label: 'notification does not prove immediate direct invocation of application callback', view: 'calls', kind: 'calls', from: { name: 'write' }, to: { name: 'callback' }, status: 'resolved' },
  ], uncertainties: [] },
  empty: { verification: manual('An empty module has containment but no executable dependencies; dependency cohesion is N/A.'), mustContain: [
    { label: 'root contains empty module', view: 'containment', kind: 'contains', from: { kind: 'repository' }, to: { kind: 'module', path: 'input.ts' } },
  ], mustNotContain: [], uncertainties: [] },
};

// Explicit containment oracles supplement the generic tree invariant. These are
// handwritten module/declaration pairs, not expectations obtained from extraction.
for (const [fixture, module, name] of [
  ['alias-escape', 'input.ts', 'aliases'], ['async-state', 'input.ts', 'refresh'],
  ['react-props', 'input.tsx', 'Panel'], ['reactive-cycle', 'input.ts', 'connect'],
  ['cross-layer', 'application/core/service.ts', 'service'], ['dispatch', 'input.ts', 'dispatch'],
] as const) fixtureOracles[fixture].mustContain.push({ label: 'module contains feature entry point', view: 'containment', kind: 'contains',
  from: { kind: 'module', path: module }, to: { name, kind: 'function', path: module } });
