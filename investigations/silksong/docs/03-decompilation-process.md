# Decompilation procedure and recordkeeping

## Completed phase: static reconnaissance

The analysis used Python 3.10.12, `pefile==2024.8.26`, and `dnfile==0.18.0` in an isolated Python environment at `/tmp/silksong-recon-venv`. Tool versions for `file`, `objdump`, and `strings` are in [run.json](recon-001/run.json). The game code was handled as bytes, never loaded with .NET reflection or executed. The analysis environment is on the same host, not an independently trusted forensic workstation.

Commands run from the repository root:

```bash
python3 -m venv /tmp/silksong-recon-venv
/tmp/silksong-recon-venv/bin/python -m pip install pefile dnfile
/tmp/silksong-recon-venv/bin/python investigations/silksong/scripts/recon.py \
  --source '/mnt/c/Program Files (x86)/Steam/steamapps/common/Hollow Knight Silksong' \
  --output investigations/silksong/docs/recon-001
python3 investigations/silksong/scripts/strings_recon.py \
  --snapshot investigations/silksong/evidence/recon-001 \
  --output investigations/silksong/docs/recon-001/raw/string-leads.json
```

The initial install resolved the versions now pinned in `requirements.txt`. For reproduction, install with `pip install -r investigations/silksong/requirements.txt`. Choose a **new** run directory under `investigations/silksong/docs/`, such as `recon-002`; the collector refuses to overwrite existing run or evidence directories. It places copies in `investigations/silksong/evidence/<run-name>/`.

The collector:

1. Enumerates regular files and records size/mtime; records symlinks without copying their targets.
2. Reads EXE/DLL files and selected small configuration files, checks source stat stability, saves copies, and verifies copy digests.
3. Records the local Steam manifest and writes an account-redacted text version into `docs/`.
4. Parses all PE headers, section metadata, imports/delay imports, exports, version resources and certificate-table sizes. Saves `objdump -p` output for the ten native files.
5. Extracts CLR table counts, types, assembly references, P/Invoke mappings, and selected methods/member references from 16 assemblies. These are not call graphs.
6. Records tool versions, script hash, timestamps and parser exceptions. A zero-exception run is not a security verdict.

The supplementary string script examines first-party named assemblies plus native binaries. Its exact pattern, selected files, SHA-256 values, encodings and file offsets are preserved in `string-leads.json`. It does not decode encrypted strings, analyze all Unicode, unpack resources, or establish that matched text is ever used.

`coverage.csv` was initialized from each entry in `pe-metadata.json`; CLR-table status comes from membership in `managed-metadata.json`. Every decompilation/review field starts as `pending`.

## Planned phase: managed decompilation

No decompiler was installed or run during recon. `dotnet`, `ilspycmd`, and `monodis` were not found on the WSL PATH. Before installation/export, provide enough storage for the toolchain and generated source; the current filesystem has less than 1 GB free.

Use a pinned release of [ILSpy/ILSpyCmd](https://github.com/icsharpcode/ILSpy), whose primary project documents C# decompilation and a cross-platform command-line tool. Record the download source, version and package digest, runtime version, and exact command/help output used. Work from the captured files, with managed dependencies resolved from the captured `Managed` directory. Do not build or run exported projects during static review.

For each assembly:

1. Verify its input SHA-256 against the inventory.
2. Export to a unique `decompiled/<run>/<assembly>/` directory, preserving C# and IL representations where supported.
3. Capture stdout/stderr, exit status, tool configuration and elapsed time.
4. Reconcile exported types/methods with metadata. Record abstract/external methods separately from failed or missing bodies.
5. Trace the initial targets in G2–G4. Preserve method tokens and IL offsets alongside source excerpts, because reconstructed C# can obscure original control flow.
6. Hash exported artifacts and update coverage and the findings log.

## Planned phase: native decompilation and asset analysis

Use a pinned [Ghidra](https://github.com/NationalSecurityAgency/ghidra) release for native disassembly/decompilation. Record processor/compiler settings, analysis options, image base, entrypoint, function counts, errors and exported artifacts for each binary. Include executable sections, exports, TLS callbacks and dynamic-loading paths. Recovered function names and C-like output are approximations.

Native function discovery is not exhaustive merely because automatic analysis finishes. Record remaining indirect branches, unidentified code, packed/encrypted content, unsupported instructions and other gaps. If a gap prevents full coverage, report it explicitly.

Acquire the remaining assets before parser-based asset work. Select an appropriate, version-pinned Unity asset reader, document its compatibility, and reconcile serialized event/FSM references with code. Asset parsing is a separate phase and was not performed in recon.

If later behavior questions require execution, design that separately in a disposable analysis environment without personal accounts or shared folders, and document network settings. Runtime execution is not part of the work completed here.

## Required record for each later step

```text
Step ID and UTC start/end:
Question / goal:
Input relative paths and SHA-256:
Tool source, version, digest and configuration:
Exact command and working directory:
Output paths and hashes; exit status / errors:
Methods/functions covered; unresolved dependencies or bodies:
Observed evidence (token + IL offset, RVA, or file offset):
Interpretation and alternative explanations:
What is still unverified:
Coverage updates and next action:
```

Keep original acquisition records unchanged. Later corrections should identify the prior claim and add the corrected interpretation to the work log. Store generated proprietary code and copied binaries under the ignored directories; retain their hashes and analysis records in `docs/`.

## Parser references

The initial analysis uses the documented capabilities of [pefile](https://github.com/erocarrera/pefile) to inspect PE structures and [dnfile](https://github.com/malwarefrank/dnfile) to parse .NET executable metadata. These libraries parse data; neither constitutes malware detection or a validation of the game's source.
