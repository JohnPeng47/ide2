# Goals and decompilation targets

The objective is to produce a reproducible code reconstruction and evidence-based behavior review of the acquired installation. Full scope means every inventoried managed and native binary receives a recorded disposition. Generated source is an analysis aid, not a promise of original source recovery or a proof of host safety.

## Work packages

| Goal | Priority and status | Targets and questions | Required output / completion criterion |
| --- | --- | --- | --- |
| G1 — Preserve inputs and establish provenance | First; partial | Captured 177 files, original Steam manifest, remaining assets, exact build/depot identifiers | Verify captured hashes; acquire/hash remaining assets on sufficient storage; obtain a separate trusted copy of the exact build where available; report added/missing/changed files. Do not repair the original installation to create a baseline. Unavailable baseline remains explicit. |
| G2 — Reconstruct primary managed code | First decompilation; pending | `Assembly-CSharp.dll`, `Assembly-CSharp-firstpass.dll`, all seven `TeamCherry.*.dll` | Export per-assembly C# and IL with pinned ILSpy tooling and local dependencies; preserve logs, tokens, unresolved references, failed methods, and output hashes. Account for every method, including generated types. |
| G3 — Map startup and reachable side effects | After G2; pending | 34 recorded runtime initializers; `ConfigManager`, `CoreLoop`, `Platform`, `DesktopPlatform`, `SteamOnlineSubsystem`, `GameManager`; static constructors and scene callbacks | Trace initialization and callers into filesystem, network, process, registry, reflection, and loading APIs. Record concrete arguments and guards, not just names. Map save/config locations and destinations. |
| G4 — Reconstruct remaining managed code | After initial G2; pending | Remaining 143 managed binaries: Steamworks, Galaxy, Xbox wrappers, PlayMaker, Newtonsoft, Unity modules, framework libraries | Complete managed export coverage; resolve native mappings and platform guards. Record all skipped, unsupported, or failed methods. Readable exports and reviewed behaviors have separate status. |
| G5 — Reconstruct native code | After acquisition/tool preparation; pending | All 10 native files: launcher, engine, Mono runtime/helper, four plugins, D3D12 runtime, crash handler | Create per-binary Ghidra projects and function/decompiler exports; identify startup, TLS callbacks, exports, imports/delay imports, dynamic loading, executable-memory and network/file operations. Track unidentified code regions and decompiler failures. Validate signature status and compare exact-build inputs where possible. |
| G6 — Reconcile code with assets | Pending storage and asset acquisition | Addressables `catalog.bin`, 2,068 bundles, `globalgamemanagers`, scenes/resources, serialized PlayMaker FSMs | Inventory catalog paths/providers, serialized callbacks/FSM actions, embedded content and URLs; connect referenced behavior to decompiled code. Record parser limits and unresolved references. |
| G7 — Evaluate findings and remaining uncertainty | Throughout; pending | All leads and coverage gaps | For each claim: file hash, method token/RVA or file offset, relevant code/data, reachability, benign alternatives, baseline comparison, and confidence. Report unresolved leads separately. Attribution requires evidence beyond code decompilation. |

The 143 remaining managed binaries are 152 total minus the 9 G2 assemblies. Native and asset work remain part of the overall scope even if the first managed review produces no concerning findings.

## Initial method anchors

These anchors are extracted from CLR metadata in the captured `Assembly-CSharp.dll` whose SHA-256 begins `70713bb2`. They identify methods for inspection; they are not reviewed call paths. Tokens and RVAs apply only to these acquired bytes.

| Target | MethodDef token | RVA | First question |
| --- | --- | --- | --- |
| `ConfigManager.Init` | `0x0600239e` | `0x000a28b8` | What configuration is loaded at startup? |
| `ConfigManager.LoadConfig` | `0x0600239f` | `0x000a290c` | Which path and parser are used? |
| `ConfigManager.SaveConfig` | `0x060023a0` | `0x000a2984` | Where can configuration writes go? |
| `CoreLoop.Init` | `0x060026fa` | `0x000b055b` | What work is registered or scheduled? |
| `DesktopPlatform.Awake` | `0x06002725` | `0x000b0cc8` | How is platform initialization selected? |
| `DesktopPlatform.CreateOnlineSubsystem` | `0x06002726` | `0x000b0d70` | Which service wrapper is instantiated and under what guard? |
| `DesktopPlatform.ReadSaveSlot` | `0x06002733` | `0x000b1048` | How are save contents read and interpreted? |
| `SteamOnlineSubsystem..ctor` | `0x060028d1` | `0x000b4134` | Which Steam APIs and callbacks are initialized? |
| `CheatManager.Init` | `0x06000bfc` | `0x00036356` | What enables the game's debug/cheat functionality? |

Additional types, selected methods, MemberRefs and P/Invoke declarations are in [managed-metadata.json](recon-001/raw/managed-metadata.json). Nested type names in this preliminary listing are not fully qualified by their enclosing types; use metadata tokens and the decompiler's full names to disambiguate.

## Coverage rules

Update [coverage.csv](coverage.csv) after each work package. Use separate statuses for metadata extraction, decompilation (`pending`, `partial`, `complete`, `failed`), and review (`pending`, `partial`, `complete`). A binary is not reviewed just because a tool emitted source. Do not silently omit third-party or runtime files. Record every exception and its effect on the conclusions.
