# Work log

## 2026-10-12 — recon-001

**Request:** perform preliminary binary reconnaissance, describe the situation in a README, and establish a written decompilation record with high-level goals and targets.

**Context:** the owner suspects the Steam-downloaded game is associated with a subtle compromise, has expressed a state-adversary hypothesis, and reports undisclosed supporting information. No specific behavior, indicator, or external evidence has been provided for assessment. The record treats this as an investigation request, not a confirmed incident or attribution.

**Workspace decision:** the current repository already contains a diagram application and README. Created `investigations/silksong/` for this unrelated investigation. No application code was changed.

**Completed operations:**

1. Read the local project instructions and checked repository status (initially clean).
2. Located Steam through its library manifest, then app manifest `1030300`; confirmed the installation and executable path.
3. Enumerated the installation and checked the main executable/assembly with `file`. Examined boot, assembly and runtime-initializer configuration.
4. Checked available tools and free space. Installed `pefile` and `dnfile` in `/tmp/silksong-recon-venv`; recorded resolved versions. The full game is larger than available analysis-disk space.
5. Ran `scripts/recon.py`; acquired 177 code/configuration files plus the app manifest; parsed 162 PE files and deeper CLR metadata for 16 assemblies. Run timestamps: `2026-10-12T16:43:53.471021+00:00` through `2026-10-12T16:44:54.191928+00:00`. No collector exceptions. Two PE files have recorded parser warnings, described in the findings.
6. Ran `scripts/strings_recon.py`; extracted 236 offset-bearing leads across 19 binaries. Read the launcher's imports and representative managed metadata, rather than interpreting string matches as behavior.
7. Reconciled the 114 names in `ScriptingAssemblies.json` with files (none missing), identified 38 additional framework-named assemblies, and initialized 162 coverage rows.
8. Wrote the README, findings, target plan and procedure. Recorded source/hash verification and record-consistency results in `recon-001/validation.json`.

**Results:** identified a Unity/Mono installation and a feasible managed-first decompilation route. Primary target `Assembly-CSharp.dll` has 7,290 TypeDef rows and 40,056 MethodDef rows. Recorded native boundaries, early method anchors, and the asset-analysis scope.

**Not completed:** source decompilation, method-body/behavior review, full asset preservation, same-build trusted comparison, Authenticode verification, runtime monitoring, or host incident analysis. All decompilation and review statuses remain pending. No conclusion about compromise or attribution follows from this pass.

**Next:** G1 storage/preservation and G2 managed toolchain/export, then startup and side-effect tracing under G3. Append each later step using the [record template](03-decompilation-process.md).
