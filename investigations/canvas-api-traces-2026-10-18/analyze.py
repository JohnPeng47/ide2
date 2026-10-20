"""Reconstruct two historical Canvas API traces; read-only against Codex history.

Run: python investigations/canvas-api-traces-2026-10-18/analyze.py
Output sizes are recorded UTF-8 text sizes, not packet captures or token counts.
"""
import ast
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent
SESSIONS = Path('/home/john/.codex/sessions')
SPECS = {
    'A': ('01a1289e-b5be-7121-8254-c92826952b38', [91, 100, 114, 121, 131, 136, 143]),
    'B': ('01a13723-9903-7130-b48a-9898d33ec808', [36, 45, 52, 64, 67, 74, 83, 84, 85]),
}


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def byte_count(value):
    return len(value.encode('utf-8'))


traces = {}
for label, (session_id, line_numbers) in SPECS.items():
    source = next(SESSIONS.rglob(f'*{session_id}.jsonl'))
    records = [json.loads(line) for line in source.open()]
    steps = []
    for line_number in line_numbers:
        record = records[line_number - 1]
        item = record['payload']['item']
        assert item['type'] == 'CommandExecution'
        output = item['aggregated_output']
        duration = item['duration']
        parts = []
        for output_line in output.splitlines():
            try:
                value = json.loads(output_line)
            except ValueError:
                continue
            parts.append({'bytes': byte_count(output_line), 'value': value})
        steps.append({
            'source_line': line_number,
            'completed_at_utc': record['timestamp'],
            'command_duration_seconds': duration['secs'] + duration['nanos'] / 1e9,
            'stdout_bytes': byte_count(output),
            'command': item['command'],
            'stdout': output,
            'json_lines': parts,
        })
    traces[label] = {'session_id': session_id, 'source': str(source), 'steps': steps}


def step(label, line):
    return next(x for x in traces[label]['steps'] if x['source_line'] == line)


docs = step('A', 100)['json_lines'][1]['value']
logical_docs = docs['structuredContent']['result']
assert json.loads(docs['content'][0]['text']) == logical_docs
search = step('A', 114)['json_lines'][2]['value']
other_search = step('B', 45)['json_lines'][2]['value']
assert search == other_search
hits = search['hits']
identity_fields = ['origin', 'representationId', 'revisionId', 'name', 'nodeId']
identity = {key: hits[0][key] for key in identity_fields}
assert all(all(hit[key] == identity[key] for key in identity) for hit in hits)
grouped = {
    'total': search['total'],
    'groups': [{**identity, 'matches': [
        {key: value for key, value in hit.items() if key not in identity}
        for hit in hits
    ]}],
    'nextOffset': search['nextOffset'],
}
# Confirm that the proposed grouping is lossless for this captured page.
assert [{**identity, **match} for match in grouped['groups'][0]['matches']] == hits
catalog_lines = step('B', 64)['stdout'].splitlines()
saved_diagram_count = sum(len(ast.literal_eval(line[line.index('['):])) for line in catalog_lines)
metrics = {
    'method_count': len(logical_docs),
    'logical_docs_compact_bytes': byte_count(compact(logical_docs)),
    'duplicated_mcp_result_compact_bytes': byte_count(compact(docs)),
    'search_hits': len(hits),
    'search_total_hits': search['total'],
    'search_compact_bytes': byte_count(compact(search)),
    'search_python_serialized_bytes': step('B', 45)['json_lines'][2]['bytes'],
    'search_snippet_utf8_bytes': sum(byte_count(hit['snippet']) for hit in hits),
    'search_grouped_compact_bytes': byte_count(compact(grouped)),
    'search_grouped_reduction_percent': 100 * (1 - byte_count(compact(grouped)) / byte_count(compact(search))),
    'saved_canvases': len(catalog_lines),
    'saved_diagrams': saved_diagram_count,
    'live_canvases': len(step('A', 131)['json_lines']),
    'live_diagrams': sum(len(part['value']['diagrams']) for part in step('A', 131)['json_lines']),
}
assert metrics['search_hits'] == 100 and metrics['saved_canvases'] == 8
(OUT / 'evidence.json').write_text(json.dumps({'metrics': metrics, 'traces': traces}, ensure_ascii=False, indent=2) + '\n')
(OUT / 'grouped-search-example.json').write_text(json.dumps(grouped, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(metrics, indent=2))
