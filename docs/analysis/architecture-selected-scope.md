# Repository architectural analysis

Static source snapshot `snapshot:080cf44202e8d365af633a08fcfe12a8587d39b92efb7c443fa200adece3e108`, based on commit `9620266136dd6316259b8af65b52469e5903a8f8`.

[Persisted analysis JSON](artifacts/selected-scope.json.gz) contains every entity, relation, source range, uncertainty, partition and finding. Gzip is lossless; decompress it before using the JSON schema.

Analyzed **18 files**, with **32 resolution-only files**, **2276 entities** and **10151 relations**. The snapshot records 1 dirty inputs with content hashes.

## What these measurements mean

This is a static possibility graph. Calls are not an execution trace; source-level ownership means aliases, mutation capabilities and lifecycle evidence, not exclusive ownership. A crossing is a candidate for investigation, not a defect. No observed/runtime evidence is emitted.

The five views share source identities but keep their own relations. Only containment is required to be a tree. Recursive calls and reactive cycles remain in the graphs; SCC condensation and containment occurrences are derived views.

## Per-view coverage

| View | Status | Relations | Resolved sites | Unresolved sites |
|---|---|---:|---:|---:|
| containment | complete | 2359 | 1839 | 0 |
| lexical | complete | 3825 | 3152 | 0 |
| calls | partial | 954 | 330 | 606 |
| ownership | partial | 616 | 486 | 118 |
| dependencies | partial | 2397 | 1796 | 23 |

Site counts count distinct source spans touched by an extraction rule. They are not recall estimates: unsupported language features can hide additional dependencies. Multiple facts can share a site.

## Cohesion, containment agreement and shuffled baselines

The universe is source declarations and value/definition/allocation entities in analyzed files, excluding modules, scopes, type-only and external entities. Each directed relation has unit weight; self-edges are excluded. Data, state and reactive layers overlap in relation kinds and must not be summed. Local def-use edges can dominate data cohesion, so call/state/reactive results are shown separately.

Cohesion is internal / (internal + between) among primary memberships. Coverage and overlap use unions of source lines, including nested declaration ranges, with physical analyzed lines as denominator. VI is in bits (lower means greater agreement), compared to the directory partition on the same entity universe. These full partitions have no uncovered members; diagram partitions can.

The null model shuffles group labels over the covered entity set while preserving group sizes. Excess cohesion is observed minus shuffled mean; this controls for a single giant group scoring 1. It does not control for degree distribution or prove near-decomposability under runtime workloads.

| Partition | Edge layer | Edges | Cohesion | Shuffled mean | Excess | VI vs directories |
|---|---|---:|---:|---:|---:|---:|
| directory | calls | 237 | 66.24% | 55.18% | 11.06% | 0.0000 |
| directory | data | 1935 | 96.85% | 55.28% | 41.57% | 0.0000 |
| directory | state | 1415 | 98.30% | 55.55% | 42.76% | 0.0000 |
| directory | reactive | 11 | 90.91% | 53.13% | 37.78% | 0.0000 |
| layer | calls | 237 | 66.24% | 55.18% | 11.06% | 0.0000 |
| layer | data | 1935 | 96.85% | 55.28% | 41.57% | 0.0000 |
| layer | state | 1415 | 98.30% | 55.55% | 42.76% | 0.0000 |
| layer | reactive | 11 | 90.91% | 53.13% | 37.78% | 0.0000 |
| custom | calls | 237 | 100.00% | 100.00% | 0.00% | 0.9213 |
| custom | data | 1935 | 100.00% | 100.00% | 0.00% | 0.9213 |
| custom | state | 1415 | 100.00% | 100.00% | 0.00% | 0.9213 |
| custom | reactive | 11 | 100.00% | 100.00% | 0.00% | 0.9213 |

**directory**: 2 groups; line coverage 88.79%, overlap 0.00%; baseline 32 shuffles, seed 1729.

**layer**: 2 groups; line coverage 88.79%, overlap 0.00%; baseline 32 shuffles, seed 1729.

**custom**: 1 groups; line coverage 88.79%, overlap 0.00%; baseline 32 shuffles, seed 1729.

## Cross-view boundary evidence

The mismatch rule compares directory containment with architectural-layer membership: an edge can stay within a layer while crossing directory groups. Mutable captures and ownership relations provide additional views of the same endpoints. This is a concrete pair of partitions, not a claim that every possible tree mismatch has been found.

### Edges local to a layer but crossing directory groups

0 findings; showing up to 12. Ranking uses distinct participants, then static evidence count; it does not estimate runtime impact.

No finding matched this rule in the selected corpus.

### Cross-directory writes

0 findings; showing up to 12. Ranking uses distinct participants, then static evidence count; it does not estimate runtime impact.

No finding matched this rule in the selected corpus.

### Mutable captures

17 findings; showing up to 12. Ranking uses distinct participants, then static evidence count; it does not estimate runtime impact.

- save captures writes with reassign access. [save](../../src/features/mapping/workspace/mappingWorkspaceRepository.ts#L18), [writes](../../src/features/mapping/workspace/mappingWorkspaceRepository.ts#L9). Evidence: `finding:1fc3dcaf0bc7ca478a29fc75e65acbd10492745af3ffdba4188bca6db00f521d` (1 relations).
- <callback:6dffa24047aa> captures this with object-mutate access. [<callback:6dffa24047aa>](../../src/features/mapping/workspace/recordStorage.ts#L68), [this](../../src/features/mapping/workspace/recordStorage.ts#L59). Evidence: `finding:26d22723b8c3c2352b37b56716f94e017cf7008af7fcc5b071f86dfdca44cc60` (1 relations).
- <callback:85c927fcebb0> captures cancelled with reassign access. [cancelled](../../src/features/mapping/workspace/ProjectionLayoutPanel.tsx#L19), [<callback:85c927fcebb0>](../../src/features/mapping/workspace/ProjectionLayoutPanel.tsx#L34). Evidence: `finding:31d5c2ec239abb0752840fd246943efc1bca9fc7bc1ff63baf5b38af0ef13ce8` (1 relations).
- <callback:6cf15d9f4dae> captures this with object-mutate access. [<callback:6cf15d9f4dae>](../../src/features/mapping/workspace/workspaceStorage.ts#L40), [this](../../src/features/mapping/workspace/workspaceStorage.ts#L37). Evidence: `finding:3246d7319421b8aab59f2669cfe48762f20de2fc6fecc6304fa0bcf59225b677` (1 relations).
- <callback:997d553528ea> captures this with object-mutate access. [<callback:997d553528ea>](../../src/features/mapping/workspace/workspaceStorage.ts#L38), [this](../../src/features/mapping/workspace/workspaceStorage.ts#L37). Evidence: `finding:3ffdd2c0e10ae1b83ad190cd6c3cf22b2a7e03fe355fce9cd9efc94785bfec58` (1 relations).
- <callback:0de28112e1f5> captures this with object-mutate access. [this](../../src/features/mapping/workspace/workspaceStorage.ts#L29), [<callback:0de28112e1f5>](../../src/features/mapping/workspace/workspaceStorage.ts#L30). Evidence: `finding:464e4a3b2637ed8ad1732e1ac60fa3e093ab6bed91f4b7e7d9b557b84d79ad12` (1 relations).
- write captures revision with reassign access. [write](../../src/features/mapping/workspace/__tests__/workspacePersistence.test.ts#L64), [revision](../../src/features/mapping/workspace/__tests__/workspacePersistence.test.ts#L63). Evidence: `finding:527295f03dc242ce56d6dde64d2e578fae6ae7ae17cdfb3cb0f1b44ad08d8a8a` (1 relations).
- <callback:b4d145a73aba> captures previous with reassign access. [previous](../../src/features/mapping/workspace/canvasSession.ts#L68), [<callback:b4d145a73aba>](../../src/features/mapping/workspace/canvasSession.ts#L69). Evidence: `finding:529c795dd0dd25ebaf6faeb5eeaff0be20fd5f15b538a822cb936081d637b9df` (1 relations).
- <callback:b4d145a73aba> captures this with object-mutate access. [this](../../src/features/mapping/workspace/canvasSession.ts#L47), [<callback:b4d145a73aba>](../../src/features/mapping/workspace/canvasSession.ts#L69). Evidence: `finding:59b60250ac41fb5bf9bc2ab02f13f73d6303cc5690316e00e122b504aebb1891` (1 relations).
- <callback:7f7c340bf4a3> captures this with object-mutate access. [this](../../src/features/mapping/workspace/recordStorage.ts#L59), [<callback:7f7c340bf4a3>](../../src/features/mapping/workspace/recordStorage.ts#L70). Evidence: `finding:59e71c556e20cef18227975197b6c73709612de196d1b2c1072cf208ce353bbf` (1 relations).
- <callback:48271af5a06b> captures finish with reassign access. [finish](../../src/features/mapping/workspace/__tests__/workspacePersistence.test.ts#L26), [<callback:48271af5a06b>](../../src/features/mapping/workspace/__tests__/workspacePersistence.test.ts#L27). Evidence: `finding:760a2e573f59a8d01218e60e395ee9037579f179c0bd0b4ab02ad52b24a5b104` (1 relations).
- <callback:fc6b825f1110> captures endpoint with reassign access. [endpoint](../../src/features/mapping/workspace/workspaceStorage.worker.ts#L5), [<callback:fc6b825f1110>](../../src/features/mapping/workspace/workspaceStorage.worker.ts#L17). Evidence: `finding:92f536a61a7fbcaeaac4768fff080c1ba66c7560da4485ba6b256558a0ce97cd` (1 relations).

### Widely shared state

37 findings; showing up to 12. Ranking uses distinct participants, then static evidence count; it does not estimate runtime impact.

- controller has 10 static readers/writers/subscribers and at least one write. [controller](../../src/features/mapping/workspace/canvasSession.ts#L24), [constructor](../../src/features/mapping/workspace/canvasSession.ts#L47), [<callback:a7954b03e657>](../../src/features/mapping/workspace/canvasWorkspace.ts#L54), [controller](../../src/features/mapping/workspace/__tests__/canvasSession.test.ts#L29), [publishStatus](../../src/features/mapping/workspace/canvasSession.ts#L93). Evidence: `finding:30e9ae4dca4688b81808ae363b148c02d479108258c02c3f45ec76083288d588` (37 relations).
- settings has 7 static readers/writers/subscribers and at least one write. [<callback:42d65a26abfe>](../../src/features/mapping/workspace/ProjectionLayoutPanel.tsx#L50), [<callback:eec03398d92f>](../../src/features/mapping/workspace/ProjectionLayoutPanel.tsx#L16), [<callback:9d66f9781a07>](../../src/features/mapping/workspace/ProjectionLayoutPanel.tsx#L21), [<callback:a8a1cad4f654>](../../src/features/mapping/workspace/ProjectionLayoutPanel.tsx#L52), [ProjectionLayoutPanel](../../src/features/mapping/workspace/ProjectionLayoutPanel.tsx#L8). Evidence: `finding:2a9928ea74ec15df00deb4ad77748047f236fc51ca6225a74fce3189873efd03` (16 relations).
- query has 7 static readers/writers/subscribers and at least one write. [<callback:be3c59304fbe>](../../src/features/mapping/workspace/MappingDiagramExplorer.tsx#L63), [<callback:ad6a12cc7b2c>](../../src/features/mapping/workspace/MappingDiagramExplorer.tsx#L64), [<callback:3b88dbc95a49>](../../src/features/mapping/workspace/MappingDiagramExplorer.tsx#L73), [<callback:3b88dbc95a49>](../../src/features/mapping/workspace/MappingDiagramExplorer.tsx#L71), [matches](../../src/features/mapping/workspace/MappingDiagramExplorer.tsx#L27). Evidence: `finding:7f0b98ac47387aa51611d612effa2e2b3d6de801d17c69092e4399b47d6c89b6` (9 relations).
- records has 6 static readers/writers/subscribers and at least one write. [records](../../src/features/mapping/workspace/workspaceStorage.ts#L8), [flush](../../src/features/mapping/workspace/workspaceStorage.ts#L64), [saveDocument](../../src/features/mapping/workspace/workspaceStorage.ts#L50), [dispose](../../src/features/mapping/workspace/workspaceStorage.ts#L65), [<callback:997d553528ea>](../../src/features/mapping/workspace/workspaceStorage.ts#L38). Evidence: `finding:1b2450a38fcf92d7f6828bd41549ff2fd144a1f7cf7bc4942720d1ffd2b7acde` (10 relations).
- error has 6 static readers/writers/subscribers and at least one write. [status](../../src/features/mapping/workspace/recordStorage.ts#L34), [error](../../src/features/mapping/workspace/recordStorage.ts#L25), [<callback:6dffa24047aa>](../../src/features/mapping/workspace/recordStorage.ts#L68), [<callback:2406fb9854f6>](../../src/features/mapping/workspace/recordStorage.ts#L71), [commit](../../src/features/mapping/workspace/recordStorage.ts#L83). Evidence: `finding:e692a938e8177e03f70505f816cf0de0b56b2df5aebc606c24ac30ffcc1f119f` (8 relations).
- cache has 5 static readers/writers/subscribers and at least one write. [cache](../../src/features/mapping/workspace/recordStorage.ts#L16), [keys](../../src/features/mapping/workspace/recordStorage.ts#L33), [get](../../src/features/mapping/workspace/recordStorage.ts#L32), [constructor](../../src/features/mapping/workspace/recordStorage.ts#L29), [batch](../../src/features/mapping/workspace/recordStorage.ts#L39). Evidence: `finding:ca5a11ed502532bc4f66add9bc8cb439e2d62fdeaf06996ac758d7b7384092d4` (11 relations).
- flight has 5 static readers/writers/subscribers and at least one write. [flight](../../src/features/mapping/workspace/recordStorage.ts#L18), [<callback:6dffa24047aa>](../../src/features/mapping/workspace/recordStorage.ts#L68), [<callback:5f2cdc26ea80>](../../src/features/mapping/workspace/recordStorage.ts#L68), [<callback:2406fb9854f6>](../../src/features/mapping/workspace/recordStorage.ts#L71), [pump](../../src/features/mapping/workspace/recordStorage.ts#L59). Evidence: `finding:3c25ad746a68ae5848784c1bf243cea0adea84bb56446ec43ab3eab448e2be7f` (9 relations).
- sequence has 5 static readers/writers/subscribers and at least one write. [status](../../src/features/mapping/workspace/recordStorage.ts#L34), [flush](../../src/features/mapping/workspace/recordStorage.ts#L77), [pump](../../src/features/mapping/workspace/recordStorage.ts#L59), [batch](../../src/features/mapping/workspace/recordStorage.ts#L39), [commit](../../src/features/mapping/workspace/recordStorage.ts#L83). Evidence: `finding:6215b9852de18c16a7b17521a0233dfa5b78d0cc8073142c44a3903c2524da3f` (6 relations).
- timer has 5 static readers/writers/subscribers and at least one write. [dispose](../../src/features/mapping/workspace/recordStorage.ts#L102), [<callback:6a985c742490>](../../src/features/mapping/workspace/recordStorage.ts#L57), [pump](../../src/features/mapping/workspace/recordStorage.ts#L59), [commit](../../src/features/mapping/workspace/recordStorage.ts#L83), [schedule](../../src/features/mapping/workspace/recordStorage.ts#L52). Evidence: `finding:852ef1ab216df2f38fe74aa1e610d49709b99d00171721e05cb567c5562d47e4` (6 relations).
- disposed has 5 static readers/writers/subscribers and at least one write. [flush](../../src/features/mapping/workspace/recordStorage.ts#L77), [dispose](../../src/features/mapping/workspace/recordStorage.ts#L102), [batch](../../src/features/mapping/workspace/recordStorage.ts#L39), [disposed](../../src/features/mapping/workspace/recordStorage.ts#L27), [commit](../../src/features/mapping/workspace/recordStorage.ts#L83). Evidence: `finding:ca2e11bb526461169129f845a14deb361b5002ee0a6d8ff9df3ae61c4127da3f` (5 relations).
- requests has 4 static readers/writers/subscribers and at least one write. [dispose](../../src/features/mapping/workspace/workspaceStorage.ts#L65), [fail](../../src/features/mapping/workspace/workspaceStorage.ts#L22), [<callback:97c95e1414f3>](../../src/features/mapping/workspace/workspaceStorage.ts#L17), [requests](../../src/features/mapping/workspace/workspaceStorage.ts#L11), [<callback:0de28112e1f5>](../../src/features/mapping/workspace/workspaceStorage.ts#L30). Evidence: `finding:96ecc68575209ab59cc81908dca8a57b9f759a03399a357cbf6f8a212d269479` (13 relations).
- pending has 4 static readers/writers/subscribers and at least one write. [pending](../../src/features/mapping/workspace/recordStorage.ts#L17), [<callback:2406fb9854f6>](../../src/features/mapping/workspace/recordStorage.ts#L71), [pump](../../src/features/mapping/workspace/recordStorage.ts#L59), [batch](../../src/features/mapping/workspace/recordStorage.ts#L39), [commit](../../src/features/mapping/workspace/recordStorage.ts#L83). Evidence: `finding:5037b0515b94977371ef861278314405b21099f3ed090072b084f09fb95c3d0b` (9 relations).

## Cycles

| Layer | Nontrivial SCCs | Largest component |
|---|---:|---:|
| layer:calls | 0 | 1 |
| layer:data | 18 | 22 |
| layer:state | 17 | 22 |
| layer:reactive | 0 | 1 |

## Uncertainty and limitations

640 unresolved/unsupported/ambiguous records, plus separately classified escape and diagnostic records. All retain source evidence in the artifact.

| View / classification / reason | Count |
|---|---:|
| calls / unresolved / dynamic-dispatch | 18 |
| calls / unresolved / external-body | 599 |
| dependencies / unsupported / unsupported-syntax | 23 |
| ownership / escape / escaped-reference | 119 |

- External declarations identify signatures without modeling their bodies. Interface/union/computed dispatch is conservative and incomplete; dynamic JavaScript prevents a complete static call graph.
- Ownership is a local alias/capability approximation. Read-only facades restrict APIs shallowly; returned nested objects can remain mutable. Disposal sites do not prove that every allocation is disposed.
- Def-use uses structured local reaching definitions. Loops and exceptional/switch control flow are explicitly reported as unsupported for precise fixed-point analysis. Heap aliasing and interprocedural flow are partial.
- React captures and declared dependency arrays are separate facts; a mismatch alone is not an effect bug. Framework summaries recognize supported library identities and receiver shapes, not arbitrary custom hooks or wrappers.
- Static edge counts are not coupling frequencies. Tests and generated declarations can strongly affect layer/group sizes. Compare selected production scopes before making a refactoring decision.

## Diagram integration

Join diagram leaf mappings through snapshot-pinned source ranges to entity IDs, retaining overlapping memberships and explicit uncovered entities. Existing source-evidence IDs and source-range IDs can be stored on source joins. A stale snapshot must not silently match current code. Concept-tree occurrences remain distinct from source entity identities, allowing the same code to appear in several canvases. Metrics can evaluate those induced partitions with the same layer definitions.
