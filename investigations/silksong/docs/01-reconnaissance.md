# Preliminary reconnaissance — recon-001

## Scope and acquisition

Acquisition ran on 2026-10-12 from `16:43:53` to `16:44:54` UTC through WSL. See [run.json](recon-001/run.json) for exact times, source path, tool versions, script digest, and error records.

The collector inventoried 2,268 regular files totaling 8,207,380,004 bytes. It captured and SHA-256 hashed 177 files totaling 93,518,624 bytes: all 162 EXE/DLL files and 15 small configuration files. Each copied file was read back and its hash checked. The original Steam app manifest was captured separately, with its own digest in the run record. Copied files have read-only permissions.

This is a selective logical acquisition, not a forensic disk image or an atomic snapshot. Individual file size and modification time were checked before and after reading; that cannot detect every concurrent or adversarial modification. No original file was intentionally modified. Access-time changes from reads are possible. The installation was not repaired or verified through Steam, which could replace evidence.

## Binary structure

| Component | Observed structure | Consequence for analysis |
| --- | --- | --- |
| `Hollow Knight Silksong.exe` | 672,256 bytes, native AMD64 PE32+, entry RVA `0x1264`; imports `UnityPlayer.dll!UnityMain2` | Inspect launcher startup and native loading; most game logic is elsewhere |
| `UnityPlayer.dll` | 33,676,200 bytes, native engine; same reported Unity product version as launcher | Separate native engine analysis from managed game code |
| `Managed/Assembly-CSharp.dll` | 7,004,160 bytes, CLR metadata; 7,290 types, 40,056 methods, 43 assembly references, 16 P/Invoke mappings | First managed decompilation target |
| `Managed/Assembly-CSharp-firstpass.dll` | 156,672 bytes; 102 types, 626 methods, 6 assembly references | Decompile alongside main assembly |
| Seven `Managed/TeamCherry.*.dll` files | CLR metadata and readable type names | First-party helper targets |
| `MonoBleedingEdge/EmbedRuntime/` | `mono-2.0-bdwgc.dll`, `MonoPosixHelper.dll` | Native runtime boundary and library resolution |
| `Plugins/x86_64/` | `InControlNative.dll`, `XInputInterface64.dll`, `lib_burst_generated.dll`, `steam_api64.dll` | Native integrations and generated native code |
| `D3D12/D3D12Core.dll`, `UnityCrashHandler64.exe` | Native graphics runtime and crash-handler binaries | Include in native coverage |
| Streaming assets | 2,068 `.bundle` files; Addressables catalog/settings present | Later asset, serialized-event, and catalog analysis |

`Managed/` and `Plugins/` above are under `Hollow Knight Silksong_Data/`. Counts and imports come from [PE metadata](recon-001/raw/pe-metadata.json) and [managed metadata](recon-001/raw/managed-metadata.json). All 162 PE files were parsed; deeper CLR table extraction covered 16 selected assemblies. Method bodies have **not** been decompiled or reviewed. Metadata names may be misleading and do not establish authorship.

This evidence supports a Unity Mono analysis workflow. Unity documents Mono as its managed/JIT scripting backend; the backend documentation is context, not evidence of this installation's authenticity. [Unity documentation](https://docs.unity3d.com/6000.0/Documentation/Manual/scripting-backends.html)

## Concrete leads for follow-up

1. `RuntimeInitializeOnLoads.json` lists 34 initializers. Game entries include `ConfigManager.Init`, `CoreLoop.Init`, `Platform.Init`, and `CheatManager.Init`. Treat the latter as a named code target, not an indicator of malicious activity. Reconcile these with static constructors, Unity lifecycle callbacks, and scene-serialized references.
2. `ScriptingAssemblies.json` lists 114 assemblies, all present. The other 38 managed binaries have framework names (`System.*`, `Mono.*`, `mscorlib`, `netstandard`, and `Accessibility`). The list is not proof of runtime loading or an exhaustive dependency graph.
3. Main-assembly MemberRef metadata includes `File.ReadAllBytes`, `File.WriteAllBytes`, directory operations, reflection, and `UnityWebRequest.SendWebRequest`. Follow callers and arguments to determine paths, endpoints, and reachable behavior; API presence alone says nothing about intent.
4. All 16 main-assembly P/Invoke mappings name `InControlNative` or `XInputInterface32/64` controller interfaces. The 32-bit interface is referenced but not included among this 64-bit installation's files; inspect architecture guards before interpreting that as a missing dependency. This table does not cover dynamic symbol resolution or the native calls of other assemblies.
5. `GalaxyCSharp`, `XGamingRuntime`, `XblPCSandbox`, and Steamworks wrappers are present. Determine platform-selection gates and whether their native dependencies are reachable in the Steam build.
6. Addressables settings report `StandaloneWindows64`, package version `2.5.0`, a runtime-path `catalog.bin`, and `m_DisableCatalogUpdateOnStart: true`. These settings do not rule out other network access. Catalog and bundle contents remain unexamined.
7. A limited ASCII/UTF-16LE scan of 19 binaries produced 236 string leads with file offsets. Examples in the main assembly include Unity/PlayMaker documentation URLs and `FromBase64String`. These are search leads, not observed connections or indicators of compromise. See [string-leads.json](recon-001/raw/string-leads.json) for scope and exact filter.

## Identity anchors

| File | SHA-256 |
| --- | --- |
| `Hollow Knight Silksong.exe` | `5957b04989de6e242938f5ee0fc745a5b1af42da8cca44b0e6f8daf30d836496` |
| `UnityPlayer.dll` | `5eadaec116a9810c68a3c67bc9ad07c6f233badeb06533987ce27deff471b21d` |
| `Assembly-CSharp.dll` | `70713bb2b1f1b0c4c6b7007fa6a8446cf79818cb5e308c48c094c4d1de7114bb` |
| `Assembly-CSharp-firstpass.dll` | `20b54cb5f31fec3a490bbee21d447ceeb0f313d91abc9ec3983e1376b529ab0c` |

The local app manifest reports app `1030300`, build `22479045`, depot `1030301`, manifest `4421626056705534276`. Inventory bytes match its `SizeOnDisk`, but matching sizes do not establish integrity. Hashes above identify the acquired bytes only; no independently trusted same-build comparison has been performed.

## Caveats and unresolved questions

- The launcher has no embedded certificate table; several other binaries do. Neither presence nor absence establishes trust. Authenticode verification, certificate-chain checking, and catalog-signature checking were not performed. PE security-directory fields were merely recorded. [Microsoft PE specification](https://learn.microsoft.com/en-us/windows/win32/debug/pe-format)
- `pefile` reports entrypoint/header warnings for `ConditionalExpression.dll` and `lib_burst_generated.dll`, both with entrypoint RVA zero. Preserve these warnings; their applicability to a DLL must be assessed before drawing conclusions. The collector reported no exceptions.
- Version resources, COFF timestamps, Steam manifests, and build metadata are file-controlled values. They have not been independently authenticated. Unusual signed integers in `BuildMetadata.json` were preserved without assuming a time encoding.
- Assets were inventoried by path, size, and modification time, but not hashed or copied. About 868 MB was free on the analysis filesystem before acquisition, insufficient for an 8.2 GB full copy. Expand storage before preserving the remaining installation or exporting large native projects.
- This pass does not examine running processes, memory, Windows persistence, Steam client integrity, system DLLs, saves outside the installation, network traffic, or kernel/firmware state. It cannot resolve a host-wide compromise allegation.
- There is no demonstrated malicious behavior or actor attribution in this record. This limited reconnaissance also cannot exclude a compromise.
