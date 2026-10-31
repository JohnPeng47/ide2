# Static-analysis persistence v1

The normative field names and enums are in `schema.ts` and `analysis.schema.json`.
This document defines their semantics. Unknown schema versions and unknown object
fields are rejected. Format changes require a schema version/migration; extractor
rule changes require an analyzer version. A library/runtime addition can use the
reserved entity/evidence variants, but is not a promise that arbitrary future output
will never need a migration.

## Snapshot and identity

- Production snapshot ID: `snapshot:sha256(canonical(snapshot header without id))`.
  The header includes repository identity, commit (null for a non-Git fixture), dirty
  manifest, file hashes, effective configuration hash, compiler/analyzer/identity
  versions and analysis scope. No timestamps, wall time, RSS or absolute machine paths.
- Record exact file bytes as SHA-256; offsets are computed over the decoded UTF-8
  text as JavaScript UTF-16 code units. BOMs, CRLF and surrogate pairs must be retained.
  Lines and columns are one-based; end positions are exclusive. A trailing newline
  does not add a phantom source line; the EOF position can be on the next empty line.
- Pin source, configuration and resolution-only files separately. Include inherited
  tsconfigs, relevant package/lock files and compiler declaration inputs in the manifest
  or configuration fingerprint. Excluded files and external summarization policy are
  explicit. A file read only to resolve a selected file is not counted as analyzed.
- The dirty-manifest schema can represent modified, added, deleted, renamed and
  untracked paths, with previous paths for renames. The current extractor records
  modified/untracked current pinned repository inputs; it does not inventory files
  deleted outside the discovered corpus or reconstruct rename history. Installed
  dependency files are content-pinned without being labeled untracked Git inputs.
  Exclude generated analysis output from inputs to prevent self-invalidating snapshots.
  Persist source files or retain retrievable Git/blob evidence for cross-machine navigation.
- Named entity key: canonical JSON tuple `[repositoryId, normalizedPath, parentEntityId,
  entityKind, declarationName, role]`. ID: `entity:sha256(key)`.
  Do not include snapshot hash, line, offset, body text, or unrelated sibling ordinal.
  A file move or declaration rename may change identity; no fuzzy correspondence is
  implied. Methods and their callable initializer have distinct `role` values.
- Anonymous functions, allocation sites, blocks, definitions and merge sites use a
  named owner plus normalized token fingerprint and syntax role. Unrelated declarations and trivia do not change their identity. The AST fingerprint
  retains literal and JSX text exactly, including meaningful whitespace inside strings.
  An edit inside an anonymous construct can change its fingerprint and descendant IDs. Indistinguishable repeated anchors
  require a disambiguator and `ambiguous` stability plus an `ambiguous-identity` issue.
  Do not claim stable identity after inserting another identical anonymous construct.
- Relation ID hashes its view, kind, endpoint IDs, stable call/reference site key,
  and semantic attributes. Repeated calls at distinct sites remain distinct. Site
  identity follows the anonymous-anchor rule. Provenance locations may change while
  the stable entity/relation ID stays the same.
- External and unknown targets are explicit entities with source provenance anchored
  at the import/call that introduced them. Repository/directory/synthetic scopes may
  anchor at a contributing file. Every fact has at least one valid pinned range.
- `runtime-instance`, `execution-event`, `value-version` and `observed` are reserved.
  Runtime IDs include run identity; static output must not emit them. Static SSA-style
  definitions and joins use `definition` and `merge`, not runtime `value-version`.

The schema permits readable symbolic IDs in hand-authored contract/numerical fixtures.
The production extractor must implement and test the hash scheme above. Identity is
independent from display names. TypeScript `private`/`readonly` and `const` do not
prove deep immutability or exclusive ownership.

## Relation directions and attribution

| View | Relation | Direction / meaning |
| --- | --- | --- |
| Containment | contains | Parent → immediate structural child; exactly one repository root, every other entity has one parent |
| Containment | imports/reexports | Importing/exporting module → referenced module; preserve type-only flag |
| Containment | jsx-child | Rendering function → component declaration; separate from calls and DOM ancestry |
| Lexical | scope-parent | Child scope → enclosing scope |
| Lexical | declares | Declaring scope → binding |
| Lexical | references | Referencing operation → binding |
| Lexical | captures/captures-this | Closure → free binding/receiver; declaring scope and channel recorded |
| Calls | calls/constructs | Nearest executing callable → target callable/class; never attribute a nested callback's calls to the enclosing function |
| Calls | registers/schedules | Registering operation → callback; does not imply immediate execution |
| Calls | resumes | Known continuation source → resumed operation; static inference only, never fabricated runtime ordering |
| Ownership | aliases | Alias binding → canonical binding/resource |
| Ownership | creates | Creating operation → allocation/resource |
| Ownership | retains/can-mutate | Holder/operation → retained resource or mutation target |
| Ownership | exposes-read-api | Facade-producing operation → wrapped resource/parameter, with shallow/deep/unknown restriction |
| Ownership | subscribes/unsubscribes/disposes | Responsible operation → resource; no claim about GC timing |
| Ownership | escapes | Escaping resource/closure → unknown or external recipient |
| Dependencies | value-flow/argument/return | Producer definition/binding → consumer binding/parameter/function result boundary |
| Dependencies | reads/selects/context-read | Resource/provider → reading operation/selector |
| Dependencies | writes | Writing operation → canonical resource, preserving property path |
| Dependencies | control | Predicate input/condition → controlled operation/definition |
| Dependencies | reactive/prop-flow | Producer/store/prop value → dependent callback/prop parameter |
| Dependencies | effect-dependency | Declared dependency expression/binding → effect callback; not every lexical capture |
| Dependencies | awaits | Awaited value/expression → continuation consumer |

Call targets resolved to declarations can still have an `external-body` issue.
Interface/union candidates are `inferred`, with a shared candidate-set grouping ID.
Unknown callback parameters remain parameter targets or explicit unknown-target
entities; they are not guessed concrete implementations. `candidateSetId` is a
grouping key, not an entity foreign key.

Capture accesses can combine `read`, `reassign`, and `object-mutate`. `x += 1` reads
and reassigns x; `x.field += 1` mutates the referenced object. Capturing a stable ref
still counts as a capture. `reach` distinguishes direct free-variable use from a
free binding needed by a nested closure. Imported bindings remain marked `import`.
An ordinary function's dynamic receiver is not an outer-this capture.

Application-owned resources are represented by their canonical declaration entity
(binding/field/parameter, with resource metadata); distinct allocation entities
describe creation sites. Aliases normalize to that canonical resource for reads/writes.
This avoids counting a store binding and its allocation twice in the metric universe.
When an allocation cannot be resolved, a symbolic access-path `state-resource` such
as `old.session` is scoped to its lexical owner. Disposal of that target is inferred;
it is not a claim that one specific runtime session or allocation has been identified.
Function-valued variables/fields expose a callable entity named after the variable;
the storage binding and callable have distinct identities. Assertions can constrain
kind when that distinction matters.

## Evidence and completeness

Every entity, relation, uncertainty and finding has status, method, rule version/name,
source ranges, optional supporting relations and an explanation. `resolved` is exact
under the declared rule/scope; `inferred` is an approximation; `unresolved` records
a gap; `observed` requires a runtime probe. Do not assign arbitrary numeric confidence.

Uncertainties preserve reason, affected entities/relations, and candidate targets.
`unresolvedCount` counts unresolved, unsupported and ambiguous-identity records;
escapes and diagnostics are recorded separately. Per-view site counts report resolved
and unresolved candidate sites, not edge counts (one site can have many candidates).
Lower unresolved counts are meaningful only with the same scope/site inventory.

`findings` link evidence to partitions and relations. Their assessment is
`investigate`, never an automatic defect judgment. Scope exclusions, imports and
unsupported behavior remain visible; no silent omission is counted as proof of purity.

## Graphs, projections and the π join

Store cycles and shared targets in the canonical graph. SCCs group a declared layer
and universe, retaining original relation IDs on condensation edges. Tree projections
have occurrence IDs separate from entity IDs. Repeated entities use shared-identity
references. Lifted edges retain the original relation ID and point to visible occurrence
endpoints; canonical endpoints never change on collapse. A later concept-tree canvas
can consume these records without confusing containment with data dependencies.

For `π`: diagram revision + leaf ID → existing evidence/source-range ID → snapshot,
path, hash, half-open source interval → entity IDs. The default join policy is
`fully-contained`: include an entity when its canonical source extent lies inside
the selected slice. `intersects` must be explicitly requested. Declaration extents
and synthetic anchors are not interchangeable; skip synthetic/external entities for
source coverage. Normalize to a chosen nonduplicated metric universe before scoring
(initially callable operations and canonical state resources).

`sourceJoins` record successful, unmapped, stale and ambiguous joins. A stale record
retains the requested old range, but has no current entity IDs; it is the sole range
exception to the current snapshot because it explicitly records failed matching.
`evidenceId` and `sourceRangeId` link existing `CodeEntityRecord`/diagram source context
without changing those records. Cross-snapshot remapping must be explicit.

## Partitions and metrics

Every partition lists a universe, groups and exactly one membership record per
entity, including uncovered entities (`groupIds: []`, `primaryGroupId: null`). Overlap
is recorded with several group IDs. Primary membership determines edge cohesion and
VI; additional memberships never make an edge internal automatically.

Select a dependency layer explicitly by view, kinds, evidence statuses and weighting.
Each directed relation contributes once, even if it has several provenance ranges.
Unit-per-relation weights every unique site relation equally; static-strength uses
the stored weights. Runtime-frequency requires observed evidence. Keep call, data,
state and reactive layers separate. Containment is not a dependency signal.

For a fixed universe, score only edges with both endpoints in that universe; report
excluded endpoint counts in the eventual analysis report. An edge whose endpoint is
in the universe but has no group is different from an excluded graph endpoint.
Self-edge policy is explicit on the layer. Four masses sum to the selected total:

- internal: both endpoints assigned the same primary group;
- between: both assigned, different groups;
- boundary: exactly one assigned;
- uncovered: neither assigned.

`internalFraction = internal / total`. `coveredCohesion = internal / (internal + between)`.
Zero denominators are `{status: "na", reason: "zero-denominator"}`, never NaN or 1.
Line coverage counts unions of mapped source lines across analyzed files, including
blank/comment lines in the denominator. Overlap counts each line once if two or more
distinct groups cover it. Resolution-only/configuration files do not enter this total.

VI uses base-2 logarithms, equal entity weights, and primary memberships over identical
universes. Uncovered entities make VI unavailable unless the caller explicitly
assigns a group. The implementation must not silently intersect universes or assign
one large uncovered group. Lower VI means more agreement, not necessarily better design.

Shuffle only primary group labels across covered entities, preserving the covered set
and exact group sizes. Keep weights and graph fixed. Persist seed/sample count, mean,
population standard deviation and observed-minus-mean cohesion. A zero-sample baseline
is N/A/not-requested. Sampling algorithm: Mulberry32 with seed coerced to uint32,
descending Fisher-Yates over entity-ID-sorted covered membership labels, reset to the
original labels for each sample. Tie sorting is Unicode code-unit order, not locale.

The four-node numerical oracle independently enumerates balanced assignments and
expects mean cohesion 1/3. Sampling is checked against that result with a fixed seed
and explicit tolerance. Never call finite fixture success whole-repo precision/recall.

## Deterministic JSON

Object keys use code-unit sort. Arrays in v1 are set-like and canonically sorted by
source path and starting offset followed by ID for provenance-bearing records;
other identified records sort by ID, and remaining values by canonical JSON encoding.
`propertyPath` preserves its segment order. Grouping evidence by source improves gzip
compression without dropping facts. The streaming writer emits one complete JSON
record per line inside arrays; the complete output remains ordinary JSON.
No runtime timing or timestamps enter the artifact. A run's measurements are returned
separately by `StaticAnalysisResult`; persist performance/iteration logs as sidecars.
Two runs of the same snapshot, rules, configuration and shuffle seed must be byte-identical.
