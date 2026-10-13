# Silksong binary investigation

This workspace records static reconnaissance and the planned decompilation of the locally installed Steam edition of **Hollow Knight: Silksong**. The owner suspects a compromise associated with the game and reports having additional information they cannot disclose. They requested decompilation as the analysis approach. The additional information is unavailable to this investigation; compromise and state-adversary attribution remain unverified.

**Status: preliminary reconnaissance complete; source decompilation and behavioral review pending.** No game executable, assembly, or installer was launched during reconnaissance. The work collected installation metadata, binary headers, managed metadata, imports, and string leads. It does not establish that the installation or host is safe or compromised.

## Target

```text
Windows: C:\Program Files (x86)\Steam\steamapps\common\Hollow Knight Silksong
WSL:     /mnt/c/Program Files (x86)/Steam/steamapps/common/Hollow Knight Silksong
```

The local Steam manifest identifies app `1030300`, build `22479045`, depot `1030301`, and depot manifest `4421626056705534276`. These are locally reported identifiers, not independent authenticity checks.

The installation contains 2,268 files / 8,207,380,004 bytes, including **152 managed assemblies and 10 native PE binaries**. The launcher imports `UnityPlayer.dll!UnityMain2`; Unity version resources report `6000.0.50f1-uum-100966-branch1 (16f07294548e)`. The Mono runtime and CLR metadata make managed decompilation the first practical target. `Assembly-CSharp.dll` is 7,004,160 bytes and contains 7,290 TypeDef rows and 40,056 MethodDef rows, including generated and nested types.

## Records

- [Reconnaissance findings](docs/01-reconnaissance.md): evidence, interpretation, hashes, and limitations.
- [Goals and targets](docs/02-goals-and-targets.md): ordered work packages and completion criteria.
- [Decompilation procedure](docs/03-decompilation-process.md): reproducible workflow and record format.
- [Work log](docs/04-work-log.md): completed operations and outstanding work.
- [Coverage register](docs/coverage.csv): one row for each of the 162 PE files; decompilation and review are pending.
- [Run metadata](docs/recon-001/run.json) and [raw inventory](docs/recon-001/raw/inventory.json): acquisition details and SHA-256 hashes for captured files.

`evidence/recon-001/` holds local, read-only copies of all 162 EXE/DLL files plus 15 small configuration files and the original Steam manifest. These copies are Git-ignored. `docs/` contains the shareable written record and extracted metadata; the manifest's account identifier is redacted there. No binaries or hashes were submitted to a scanning service. Tool documentation was consulted and Python analysis packages were downloaded.

## Next work

Begin with G1–G3 in the [target plan](docs/02-goals-and-targets.md): preserve the remaining assets on storage with enough capacity, prepare the decompiler, and export the primary managed code with dependencies resolved from the captured assemblies. Record errors and method coverage before investigating individual behaviors. Continue through all binary groups; priorities determine order, not exclusions.

Re-running acquisition requires a new run directory and the pinned packages in `requirements.txt`. See the [procedure](docs/03-decompilation-process.md). The existing application README and source code are outside this investigation.
