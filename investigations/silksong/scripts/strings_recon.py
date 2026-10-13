#!/usr/bin/env python3
"""Extract offset-bearing string leads from acquired binaries, without execution."""
import argparse
import hashlib
import json
from pathlib import Path
import re

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--snapshot', required=True, type=Path)
parser.add_argument('--output', required=True, type=Path)
args = parser.parse_args()
if args.output.exists():
    parser.error('Output already exists; preserve prior runs')
pattern = re.compile(r'https?://|wss?://|powershell|cmd\.exe|rundll32|regsvr32|schtasks|CreateRemoteThread|WriteProcessMemory|VirtualAllocEx|LoadLibrary|GetProcAddress|AssemblyResolve|DownloadString|DownloadFile|UploadData|ProcessStartInfo|FromBase64String', re.I)
results = []
for path in sorted(args.snapshot.rglob('*')):
    if path.suffix.lower() not in {'.dll', '.exe'}:
        continue
    rel = path.relative_to(args.snapshot).as_posix()
    # Prioritize game code, first-party helpers and native files, excluding managed frameworks.
    if '/Managed/' in '/' + rel and not (
        path.name.startswith(('Assembly-CSharp', 'TeamCherry.'))):
        continue
    data = path.read_bytes()
    hits = []
    for encoding, regex in [('ascii', rb'[\x20-\x7e]{6,}'), ('utf-16le', rb'(?:[\x20-\x7e]\x00){6,}')]:
        for match in re.finditer(regex, data):
            value = match.group().decode(encoding)
            if pattern.search(value):
                hits.append({'file_offset': hex(match.start()), 'encoding': encoding, 'text': value})
    results.append({'path': rel, 'sha256': hashlib.sha256(data).hexdigest(), 'matches': hits})
args.output.write_text(json.dumps({'meaning': 'String leads only; no execution or reachability established.',
                                   'pattern': pattern.pattern, 'files': results}, indent=2) + '\n')
print('Scanned', len(results), 'binaries;', sum(len(r['matches']) for r in results), 'string leads')
