#!/usr/bin/env python3
"""Read-only installation reconnaissance; never loads or executes target code."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
from pathlib import Path
import platform
import re
import shutil
import subprocess

import dnfile
import pefile


def utc():
    return datetime.now(timezone.utc).isoformat()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def decode(value):
    return value.decode('utf-8', errors='replace') if isinstance(value, bytes) else str(value)


def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=True) + '\n')


def rows(tables, name):
    return getattr(getattr(tables, name, None), 'rows', [])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True, help='New run directory; must not exist')
    args = parser.parse_args()
    root = args.source.resolve(strict=True)
    out = args.output.resolve()
    if out == root or root in out.parents:
        parser.error('Output must be outside the installation')
    out.mkdir(parents=True, exist_ok=False)
    raw = out / 'raw'
    raw.mkdir()
    evidence = out.parents[1] / 'evidence' / out.name
    evidence.mkdir(parents=True, exist_ok=False)
    meta = {'started_utc': utc(), 'source': str(root), 'output': str(out),
            'snapshot': str(evidence), 'python': platform.python_version(),
            'tools': {n: importlib.metadata.version(n) for n in ['pefile', 'dnfile']},
            'script_sha256': sha(Path(__file__).read_bytes()),
            'errors': [], 'scope': 'Inventory all regular files; snapshot/hash EXE, DLL and small configuration files. No game execution.'}
    for tool in ['file', 'objdump', 'strings']:
        result = subprocess.run([tool, '--version'], capture_output=True, text=True)
        meta['tools'][tool] = result.stdout.splitlines()[0]
    inventory, binaries, managed = [], [], []
    # Inventory is metadata-only for assets. Symlinks are recorded, not followed.
    for p in sorted(root.rglob('*')):
        rel = p.relative_to(root).as_posix()
        if p.is_symlink():
            inventory.append({'path': rel, 'symlink': str(p.readlink())})
            continue
        if not p.is_file():
            continue
        before = p.stat()
        item = {'path': rel, 'size': before.st_size, 'mtime_ns': before.st_mtime_ns}
        selected = p.suffix.lower() in {'.exe', '.dll'} or (
            p.suffix.lower() in {'.json', '.config', '.info', '.txt', '.hash'} and before.st_size < 1_000_000)
        if selected:
            data = p.read_bytes()
            after = p.stat()
            if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                raise RuntimeError(f'Source changed during acquisition: {rel}')
            dest = evidence / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
            dest.chmod(0o400)
            item['sha256'] = sha(data)
            item['snapshot_sha256_verified'] = sha(dest.read_bytes()) == item['sha256']
            if p.suffix.lower() in {'.exe', '.dll'}:
                binaries.append((rel, dest))
            else:
                target = raw / 'config' / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
        inventory.append(item)
    save(raw / 'inventory.json', inventory)
    meta['file_count'] = sum('size' in x for x in inventory)
    meta['total_bytes'] = sum(x.get('size', 0) for x in inventory)
    meta['extension_counts'] = dict(Counter(Path(x['path']).suffix.lower() for x in inventory if 'size' in x))
    meta['snapshot_files'] = sum('sha256' in x for x in inventory)
    meta['snapshot_bytes'] = sum(x['size'] for x in inventory if 'sha256' in x)
    # Steam metadata can contain account IDs; keep the original only in ignored evidence.
    manifest = root.parent.parent / 'appmanifest_1030300.acf'
    manifest_data = manifest.read_bytes()
    (evidence / 'appmanifest_1030300.acf').write_bytes(manifest_data)
    (evidence / 'appmanifest_1030300.acf').chmod(0o400)
    meta['steam_manifest_sha256'] = sha(manifest_data)
    redacted = re.sub(r'("LastOwner"\s+")[^"]+', r'\1[REDACTED]', manifest_data.decode())
    (raw / 'appmanifest_1030300.redacted.acf').write_text(redacted)
    print(f"Inventoried {meta['file_count']} files; captured {meta['snapshot_files']} files", flush=True)
    pe_reports = []
    focus_names = {'Assembly-CSharp.dll', 'Assembly-CSharp-firstpass.dll',
                   'com.rlabrecque.steamworks.net.dll', 'GalaxyCSharp.dll',
                   'XGamingRuntime.dll', 'XblPCSandbox.dll', 'PlayMaker.dll',
                   'Unity.Addressables.dll', 'Unity.ResourceManager.dll'}
    interesting = re.compile(r'System\.(IO|Net|Reflection|Diagnostics)|Registry|Marshal|Assembly|Process|LoadLibrary|GetProcAddress|WebRequest|Socket|Download|Upload|Platform|Steam|ConfigManager|CoreLoop|GameManager|SaveGame|CheatManager', re.I)
    for rel, dest in binaries:
        try:
            pe = pefile.PE(str(dest), fast_load=True)
            pe.parse_data_directories(directories=[1, 0, 13, 2])
            clr = pe.OPTIONAL_HEADER.DATA_DIRECTORY[14]
            cert = pe.OPTIONAL_HEADER.DATA_DIRECTORY[4]
            record = {'path': rel, 'sha256': sha(dest.read_bytes()),
                      'machine': hex(pe.FILE_HEADER.Machine),
                      'optional_header_magic': hex(pe.OPTIONAL_HEADER.Magic),
                      'coff_timestamp_raw': pe.FILE_HEADER.TimeDateStamp,
                      'entrypoint_rva': hex(pe.OPTIONAL_HEADER.AddressOfEntryPoint),
                      'clr_directory_present': bool(clr.VirtualAddress and clr.Size),
                      'certificate_table_size': cert.Size,
                      'signature_validation': 'not performed',
                      'sections': [{'name': decode(s.Name.rstrip(b'\0')), 'raw_size': s.SizeOfRawData,
                                    'virtual_size': s.Misc_VirtualSize, 'entropy': round(s.get_entropy(), 3),
                                    'characteristics': hex(s.Characteristics)} for s in pe.sections],
                      'imports': {}, 'delay_imports': {}, 'exports': [], 'version_strings': {}}
            for attribute, key in [('DIRECTORY_ENTRY_IMPORT', 'imports'), ('DIRECTORY_ENTRY_DELAY_IMPORT', 'delay_imports')]:
                for entry in getattr(pe, attribute, []):
                    record[key][decode(entry.dll)] = [decode(i.name) if i.name else f'ordinal:{i.ordinal}' for i in entry.imports]
            for e in getattr(getattr(pe, 'DIRECTORY_ENTRY_EXPORT', None), 'symbols', []):
                record['exports'].append({'name': decode(e.name) if e.name else None, 'ordinal': e.ordinal, 'rva': hex(e.address)})
            for group in getattr(pe, 'FileInfo', []):
                for info in group:
                    for table in getattr(info, 'StringTable', []):
                        record['version_strings'].update({decode(k): decode(v) for k, v in table.entries.items()})
            record['parser_warnings'] = pe.get_warnings()
            pe_reports.append(record)
            is_managed = record['clr_directory_present']
            pe.close()
            if not is_managed:
                result = subprocess.run(['objdump', '-p', str(dest)], capture_output=True, text=True)
                target = raw / 'native' / (rel.replace('/', '__') + '.objdump.txt')
                target.parent.mkdir(exist_ok=True)
                target.write_text(result.stdout + result.stderr)
                if result.returncode:
                    meta['errors'].append({'path': rel, 'objdump_exit': result.returncode})
            if is_managed and (dest.name in focus_names or dest.name.startswith('TeamCherry.')):
                print('Reading CLR metadata:', rel, flush=True)
                dn = dnfile.dnPE(str(dest))
                tables = dn.net.mdtables
                report = {'path': rel, 'sha256': record['sha256'],
                          'metadata_version': decode(dn.net.metadata.struct.Version).rstrip('\0'),
                          'table_counts': {name: len(rows(tables, name)) for name in ['TypeDef', 'MethodDef', 'AssemblyRef', 'MemberRef', 'ImplMap', 'ManifestResource']},
                          'assembly_refs': [str(r.Name) for r in rows(tables, 'AssemblyRef')],
                          'types': [f'{r.TypeNamespace}.{r.TypeName}'.lstrip('.') for r in rows(tables, 'TypeDef')],
                          'pinvoke': [{'module': str(r.ImportScope.row.Name), 'import': str(r.ImportName),
                                       'member': str(r.MemberForwarded.row.Name)} for r in rows(tables, 'ImplMap')],
                          'resources': [str(r.Name) for r in rows(tables, 'ManifestResource')],
                          'selected_member_refs': [], 'selected_methods': []}
                for r in rows(tables, 'MemberRef'):
                    parent = r.Class.row
                    full = '.'.join(str(getattr(parent, field, '')) for field in ['TypeNamespace', 'TypeName']).strip('.')
                    name = full + '::' + str(r.Name)
                    if interesting.search(name):
                        report['selected_member_refs'].append(name)
                for t in rows(tables, 'TypeDef'):
                    typename = f'{t.TypeNamespace}.{t.TypeName}'.lstrip('.')
                    for index in t.MethodList:
                        m = index.row
                        if interesting.search(typename + '::' + str(m.Name)):
                            report['selected_methods'].append({'type': typename, 'method': str(m.Name),
                                                               'token': hex(0x06000000 | index.row_index), 'rva': hex(m.Rva)})
                managed.append(report)
                dn.close()
        except Exception as exc:
            meta['errors'].append({'path': rel, 'error': repr(exc)})
    save(raw / 'pe-metadata.json', pe_reports)
    save(raw / 'managed-metadata.json', managed)
    meta['pe_count'] = len(pe_reports)
    meta['managed_pe_count'] = sum(x['clr_directory_present'] for x in pe_reports)
    meta['managed_deep_metadata_count'] = len(managed)
    meta['finished_utc'] = utc()
    save(out / 'run.json', meta)
    print(json.dumps({k: v for k, v in meta.items() if k not in ['tools', 'extension_counts']}, indent=2), flush=True)


if __name__ == '__main__':
    main()
