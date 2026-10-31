# Combinatorial corpus coverage

The executable source of truth is `coverageMatrix.ts`: a normal Vitest test requires
exactly one entry for all 30 view/feature combinations and checks that each entry
names a real positive assertion or uncertainty assertion of the correct view.
This is feature/view interaction coverage, not exhaustive path coverage or all
six-feature combinations. Several fixtures exercise many cells simultaneously.

| Hard feature | Containment | Lexical | Calls | Ownership | Dependencies |
| --- | --- | --- | --- | --- | --- |
| Aliasing | alias-escape: module/function | alias-escape: captured alias | alias-escape: invoke through alias | alias-escape: canonical mutation target | alias-escape: write canonical state |
| Async | async-state: module/function | async-state: captured state | async-state: loader call | async-state: callback mutation capability | async-state: post-await parameter write |
| Callbacks through props | react-props: JSX composition | react-props: parent callback capture | react-props: child handler invokes prop | react-props: setter capability | react-props: handler-to-prop flow |
| Cycles | reactive-cycle: hierarchy stays a tree | reactive-cycle: captured store | recursion: mutual/self recursion | reactive-cycle: subscriber mutation capability | reactive-cycle: feedback write |
| Cross-layer edges | cross-layer: module/declaration location | cross-layer: imported state capture | cross-layer: service calls domain write | cross-layer: mutation of imported Set | cross-layer: state read by application callback |
| Unresolved externals | dispatch: declaration containment | alias-escape: captured alias survives escape | dispatch: unresolved interface/computed call | alias-escape: explicit escape | async-state: known local write despite unknown loader body |

## Additional discriminating cases

- **branch-explosion:** twenty independent conditional updates encode over a million
  execution paths in 25 lines. The static pass must analyze control-flow joins rather
  than enumerate paths; capture and control-dependence oracles remain tiny.
- **shadowing:** equal spelling, different declaration identities. A negative oracle
  rejects capturing the wrong `value`.
- **hoisting:** `var` in an if block is declared by function scope; `let` belongs to
  the block. The returned closure does not acquire an unrelated local.
- **captured-cell:** read+reassignment of a captured `let` versus mutation through
  a captured `const` object. A read-only closure must not become a writer.
- **def-use:** a killed definition does not reach the return; conditional definitions
  merge; a destructured property flows into its renamed binding.
- **imports:** re-export aliases resolve to their declarations; type-only imports
  remain visible for organization but do not become runtime calls/value flow.
- **this-capture:** arrows retain outer receivers; ordinary functions do not.
- **empty:** no executable dependency mass means N/A, not perfect cohesion.
- **identity metamorphism:** prepend an unrelated exported declaration; named entity
  IDs stay stable while snapshot identity changes.
- **numerical graph:** weighted internal/between/boundary/uncovered masses, overlap,
  VI in bits, unequal universes, empty inputs, observed/static separation, and a
  reproducible shuffled baseline checked against an independently enumerated mean.

## Real-source combinations

| Seed | Reason it is difficult | Independent golden |
| --- | --- | --- |
| CanvasSession | constructor allocation, readable facade, captured mutable previous, subscription publication | session.golden.json |
| CanvasWorkspace + CanvasSession | conditional session creation/reuse/replacement, cleanup, cross-file methods, nested callbacks | workspace.golden.json |
| CanvasRuntimeContext + session/controller | framework calls, lexical this, controller notification, atom mutation | runtime.golden.json |
| CanvasCursorCopy + CursorCopyOverlay | private store/read facade, Zustand selector, stable refs, effect captures different from dependency arrays | react-selector.golden.json |
| Seven-file subsystem | all of the above plus React layout effects constructing/connecting runtime and clipboard issuing controller commands | subsystem.golden.json |

The full-repo tier checks emitted coverage and invariants without an impossible
hand-authored oracle for every statement. Its unresolved rate is diagnostic, not
an accuracy guarantee. Missing dependency bodies must remain explicit even when
the surrounding local analysis is precise.

## Phase 2 precision regressions

These cases were added from source reasoning, then observed to fail before their
fixes. They supplement the original matrix and goldens rather than replacing them.

| Fixture | Additional combination |
| --- | --- |
| precision | Early-return reachability, ternary/short-circuit joins, reassigned object aliases, scalar copies, actual/formal arguments, call results, await initializers |
| identity-tokens | Literal whitespace versus trivia, comment-stable anonymous IDs, explicitly ambiguous repeated anchors |
| framework-lifecycle | Constructor-assigned stores, shallow wrapper facades, cleanup declared before construction, React context provider/consumer flow |
| callback-forwarding | Worklist propagation through arguments and returned closures; callable identities kept distinct from returned values |

| Source coordinates | BOM, CRLF, CR, Unicode separators and surrogate pairs | Exact source hashes, UTF-16 offsets and line/column round trip |
