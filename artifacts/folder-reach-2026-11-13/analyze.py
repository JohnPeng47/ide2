"""Deterministic folder reach from the analyzer's canonical record-stream JSON.

Run from repository root: python3 artifacts/folder-reach-2026-11-13/analyze.py
No extraction, source modification, or manual concept memberships are performed.
"""
import collections
import csv
import gzip
import hashlib
import json
import pathlib
import re

OUT = pathlib.Path(__file__).parent
SOURCE = pathlib.Path('docs/analysis/artifacts/whole-repository.json.gz')
ROOTS = {'src', 'domain', 'application', 'infrastructure'}
EXCLUDE = re.compile(r'(^|/)(__tests__|tests?|fixtures|__fixtures__|benchmarks?)(/|$)|\.(test|spec|integration)\.[^/]+$')
KINDS = {'class', 'interface', 'type', 'function', 'binding'}
CHANNELS = ['calls', 'reads', 'writes', 'reactive', 'lifecycle']


def production(path):
    return path.split('/')[0] in ROOTS and not EXCLUDE.search(path) and not path.endswith('.d.ts')


def group(path, coarse=False):
    parts = path.split('/')[:-1]
    # Coarse grouping: first feature directory below each architectural root.
    depth = 4 if parts[:2] in [['src', 'features'], ['src', 'server']] else 3
    return '/'.join(parts[:depth] if coarse else parts) or '.'


def read_graph():
    entities, parents, edges = {}, {}, []
    section = None
    counts = collections.Counter()
    snapshot = coverage = None
    with gzip.open(SOURCE, 'rt') as stream:
        for line in stream:
            header = re.match(r'^"(entities|relations)":\[', line)
            if header:
                section = header[1]
                continue
            if line.startswith(']'):
                section = None
            if line.startswith('"snapshot":'):
                snapshot = json.loads(line[len('"snapshot":'):].rstrip(',\n'))
            if line.startswith('"coverage":'):
                coverage = json.loads(line[len('"coverage":'):].rstrip(',\n'))
            if not section or not line.startswith('{'):
                continue
            item = json.loads(line.rstrip(',\n'))
            counts[section] += 1
            if section == 'entities':
                loc = item['provenance']['locations'][0]
                entities[item['id']] = dict(id=item['id'], name=item['name'], kind=item['kind'],
                    path=loc['path'], line=loc['start']['line'], origin=item['identity']['origin'],
                    test=item['metadata'].get('layer') == 'test')
                continue
            view, kind = item['view'], item['kind']
            if view == 'containment' and kind == 'contains':
                assert item['to'] not in parents, 'Multiple containment parents'
                parents[item['to']] = item['from']
            channel, reverse = None, False
            if view == 'calls' and kind in {'calls', 'constructs'}:
                channel = 'calls'
            elif view == 'dependencies':
                if kind == 'reads':
                    channel, reverse = 'reads', True
                elif kind == 'writes':
                    channel = 'writes'
                elif kind in {'reactive', 'selects', 'context-read', 'effect-dependency'}:
                    channel, reverse = 'reactive', True
            elif view == 'ownership' and kind in {'creates', 'retains', 'subscribes', 'unsubscribes', 'disposes'}:
                channel = 'lifecycle'
            if channel and item['provenance']['status'] in {'resolved', 'inferred'}:
                a, b = item['from'], item['to']
                if reverse:
                    a, b = b, a
                edges.append((a, b, channel, item['id'], item['provenance']['status']))
    assert snapshot and coverage
    assert counts['entities'] == 123967 and counts['relations'] == 618244, counts
    return entities, parents, edges, snapshot, coverage, counts


def analyze():
    entities, parents, edges, snapshot, coverage, counts = read_graph()
    analyzed = {f['path'] for f in snapshot['files'] if f['role'] == 'analyzed'}
    eligible = {i for i, e in entities.items() if e['path'] in analyzed and production(e['path'])
                and not e['test'] and e['origin'] in {'source', 'synthetic'}
                and e['kind'] not in {'external', 'unknown-target', 'repository', 'directory', 'module'}}
    owners = {}
    for ident in eligible:
        current, chain, seen = ident, [], set()
        while current in entities and entities[current]['kind'] not in {'module', 'directory', 'repository'}:
            assert current not in seen, 'Containment cycle'
            seen.add(current)
            if entities[current]['kind'] in KINDS and entities[current]['origin'] == 'source':
                chain.append(current)
            current = parents.get(current)
        # Outermost class wins; otherwise outermost interface/type/function/binding.
        classes = [i for i in chain if entities[i]['kind'] == 'class']
        owners[ident] = (classes or chain)[-1] if chain else None
    concepts = sorted({i for i in owners.values() if i})
    results = {}
    for coarse in [False, True]:
        name = 'coarse' if coarse else 'directory'
        incoming = {i: {c: set() for c in CHANNELS} for i in concepts}
        outgoing = {i: {c: set() for c in CHANNELS} for i in concepts}
        evidence = collections.defaultdict(list)
        folder_edges = collections.defaultdict(set)
        for a, b, channel, relation, status in edges:
            if a not in eligible or b not in eligible:
                continue
            ga, gb = group(entities[a]['path'], coarse), group(entities[b]['path'], coarse)
            if ga == gb:
                continue
            folder_edges[(ga, gb, channel)].add(relation)
            ca, cb = owners[a], owners[b]
            if ca == cb and ca is not None:
                continue
            if cb:
                incoming[cb][channel].add(ga)
                evidence[(cb, channel, ga)].append(dict(relation=relation, status=status,
                    consumer=entities[a], target=entities[b]))
            if ca:
                outgoing[ca][channel].add(gb)
        rows = []
        for ident in concepts:
            e = entities[ident]
            row = {k: e[k] for k in ['id', 'name', 'kind', 'path', 'line']}
            row['incoming'] = {c: sorted(incoming[ident][c]) for c in CHANNELS}
            row['outgoing'] = {c: sorted(outgoing[ident][c]) for c in CHANNELS}
            row['reach'] = {c: len(incoming[ident][c]) for c in CHANNELS}
            row['outgoingReach'] = {c: len(outgoing[ident][c]) for c in CHANNELS}
            row['examples'] = {c: {g: sorted(evidence[(ident, c, g)], key=lambda x: x['relation'])[:2]
                                 for g in row['incoming'][c]} for c in CHANNELS}
            rows.append(row)
        rows.sort(key=lambda r: (-r['reach']['calls'], r['path'], r['name'], r['id']))
        results[name] = rows
        with (OUT / f'{name}-concepts.csv').open('w') as stream:
            writer = csv.writer(stream)
            writer.writerow(['name', 'kind', 'path', 'snapshot_line'] + [f'incoming_{c}' for c in CHANNELS] + [f'outgoing_{c}' for c in CHANNELS])
            for row in rows:
                writer.writerow([row[k] for k in ['name', 'kind', 'path', 'line']] + [row['reach'][c] for c in CHANNELS] + [row['outgoingReach'][c] for c in CHANNELS])
        with (OUT / f'{name}-edges.csv').open('w') as stream:
            writer = csv.writer(stream)
            writer.writerow(['consumer_folder', 'provider_folder', 'relationship', 'relation_count'])
            for (a, b, c), ids in sorted(folder_edges.items()):
                writer.writerow([a, b, c, len(ids)])
    digest = hashlib.sha256()
    with SOURCE.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    result = dict(snapshot=snapshot, coverage=coverage, counts=dict(counts),
                  productionFiles=len({entities[i]['path'] for i in eligible}),
                  productionDirectories=len({group(entities[i]['path']) for i in eligible}),
                  source=str(SOURCE), sourceSha256=digest.hexdigest(),
                  results=results)
    (OUT / 'results.json').write_text(json.dumps(result, indent=2, sort_keys=True) + '\n')
    for channel in CHANNELS:
        print('\nTOP CLASSES:', channel)
        rows = [r for r in results['directory'] if r['kind'] == 'class']
        for r in sorted(rows, key=lambda r: (-r['reach'][channel], r['path'], r['name']))[:12]:
            print(r['reach'][channel], r['name'], r['path'])
    print('\nTOP ALL CONCEPTS: calls')
    for row in results['directory'][:15]:
        print(row['reach'], row['name'], row['kind'])
    print('Production files/directories:', result['productionFiles'], result['productionDirectories'])


if __name__ == '__main__':
    analyze()
