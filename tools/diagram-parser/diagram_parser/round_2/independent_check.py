"""Source-specific independent audit; never imports or invokes the parser.

Boundaries and routed-wire labels below were established by reading all six
original ASCII files. This is an audit fixture, not a general-purpose parser.
Run from any directory: python /absolute/path/to/independent_check.py
"""
from pathlib import Path
import hashlib
import json
import re
from collections import Counter

BASE = Path(__file__).resolve().parent
# Each tuple is (unmarked root line, last line of its tree).
SECTIONS = {
    'astra_1': [(1, 120)],
    'astra_2': [(1, 117)],
    'astra_3': [(5, 138)],
    'sol_1': [(4, 123)],
    'sol_2': [(1, 110), (112, 120)],
    'sol_3': [(4, 113), (118, 123), (125, 132), (134, 140), (142, 151)],
}
WIRE_LABELS = {
    16: 'currentRevisionId',
    17: 'revisions: 1..* (through catalog)',
    20: 'ProjectRepresentationRevisionRecord',
    35: 'collapsedContentId?',
    37: 'DiagramGridBox',
    38: 'kind: diagram',
    39: 'contentId',
    41: 'ContainerGridBox',
    42: 'kind: container',
    43: 'children: GridBox[] (recursive)',
    44: 'layout',
    45: 'collisionPolicy: push-right',
    46: 'gap',
    48: 'contents: { contentId -> GridContent }',
}
BRANCH = re.compile(r'^([ |]*)([+|`\\]--) (.*)$')


def derive(generator, lines):
    nodes = []
    for first, last in SECTIONS[generator]:
        root = {'line': first, 'label': lines[first - 1], 'parent_line': None,
                'depth': 0, 'column': 1, 'branch_column': 0}
        nodes.append(root)
        stack = {0: first}
        for number in range(first + 1, last + 1):
            raw = lines[number - 1]
            if not raw.strip() or set(raw.strip()) <= {'|', ' '} or set(raw.strip()) <= {'='}:
                continue
            match = BRANCH.fullmatch(raw)
            assert match, (generator, number, raw)
            prefix, marker, label = match.groups()
            assert len(prefix) % 4 == 0, (generator, number, prefix)
            depth = len(prefix) // 4 + 1
            assert depth - 1 in stack, (generator, number, depth)
            if generator == 'sol_3':
                label = WIRE_LABELS.get(number, label)
            nodes.append({'line': number, 'label': label,
                          'parent_line': stack[depth - 1], 'depth': depth,
                          'column': len(prefix) + 5, 'branch_column': len(prefix) + 1})
            stack = {key: value for key, value in stack.items() if key < depth}
            stack[depth] = number
    for node in nodes:
        node['children_lines'] = [x['line'] for x in nodes if x['parent_line'] == node['line']]
    return nodes


def audit(entry):
    generator = entry['generator']
    source = BASE / entry['source']
    source_bytes = source.read_bytes()
    lines = source_bytes.decode().splitlines()
    expected = derive(generator, lines)
    # Ordinary prose bullets in this one source have two reasonable readings.
    # Compare the common, unambiguous portion exhaustively and record the seven
    # nodes separately, rather than silently selecting a boundary to force a verdict.
    ambiguous_lines = [137, 140, 141, 142, 143, 144, 145] if generator == 'sol_1' else []
    actual = json.loads((BASE / entry['parsed']).read_text())
    by_id = {node['id']: node for node in actual['nodes']}
    by_line = {node['line']: node for node in actual['nodes']}
    assert len(by_id) == len(by_line) == len(actual['nodes'])
    # Verify the independently supplied review tables describe the same full output.
    review_text = (BASE / entry['reviewTable']).read_text()
    review_rows = review_text.split('\n\n', 1)[0].splitlines()[1:]
    assert len(review_rows) == len(actual['nodes'])
    for row, node in zip(review_rows, actual['nodes']):
        identity, number, parent, depth, label = row.split(maxsplit=4)
        assert (int(identity), int(number), int(depth), json.loads(label)) == (node['id'], node['line'], node['depth'], node['label'])
        assert parent == ('ROOT' if node['parent_id'] is None else str(by_id[node['parent_id']]['line']))
    ambiguity_alternative = []
    for number in ambiguous_lines:
        observed = by_line[number]
        parent_line = None if number == 137 else 137
        label = lines[number - 1] if number == 137 else lines[number - 1][2:]
        expected_children = list(range(140, 146)) if number == 137 else []
        assert observed['label'] == label
        assert (None if observed['parent_id'] is None else by_id[observed['parent_id']]['line']) == parent_line
        assert [by_id[x]['line'] for x in observed['children']] == expected_children
        assert observed['depth'] == (0 if number == 137 else 1)
        assert observed['column'] == (1 if number == 137 else 3)
        assert observed['branch_column'] == (0 if number == 137 else 1)
        assert observed['end_line'] == number and observed['raw_lines'] == [lines[number - 1]]
        ambiguity_alternative.append({'line': number, 'label': label, 'parent_line': parent_line, 'children_lines': expected_children})
    findings = []
    for node in expected:
        number = node['line']
        parsed = by_line.get(number)
        if parsed is None:
            findings.append({'line': number, 'kind': 'missing_node', 'expected': node, 'actual': None})
            continue
        observed = {
            'line': parsed['line'], 'label': parsed['label'],
            'parent_line': None if parsed['parent_id'] is None else by_id[parsed['parent_id']]['line'],
            'depth': parsed['depth'], 'column': parsed['column'], 'branch_column': parsed['branch_column'],
            'children_lines': [by_id[x]['line'] for x in parsed['children']],
        }
        for field, value in node.items():
            if observed[field] != value:
                findings.append({'line': number, 'kind': field + '_mismatch', 'expected': value, 'actual': observed[field]})
        for field, value in [('end_line', number), ('raw_lines', [lines[number - 1]])]:
            if parsed[field] != value:
                findings.append({'line': number, 'kind': field + '_mismatch', 'expected': value, 'actual': parsed[field]})
    expected_by_line = {node['line']: node for node in expected}
    for node in actual['nodes']:
        if node['line'] not in expected_by_line and node['line'] not in ambiguous_lines:
            findings.append({'line': node['line'], 'kind': 'extra_node', 'expected': None, 'actual': node})
    expected_roots = [node['line'] for node in expected if node['parent_line'] is None]
    actual_roots = [by_id[x]['line'] for x in actual['roots']]
    if [x for x in actual_roots if x not in ambiguous_lines] != expected_roots:
        findings.append({'kind': 'roots_mismatch', 'expected': expected_roots, 'actual': actual_roots})
    # Independently check internal parent/child reciprocity, including ambiguous nodes.
    for node in actual['nodes']:
        assert node['children'] == [x['id'] for x in actual['nodes'] if x['parent_id'] == node['id']]
    assert actual['roots'] == [x['id'] for x in actual['nodes'] if x['parent_id'] is None]
    assert [x['line'] for x in actual['nodes']] == sorted(by_line)
    assert len(actual['lines']) == len(lines)
    accounting = []
    for number, (raw, parsed_line) in enumerate(zip(lines, actual['lines']), 1):
        assert parsed_line['line'] == number and parsed_line['raw'] == raw
        if number in expected_by_line:
            kind = 'node'
        elif number in ambiguous_lines:
            kind = 'ambiguous_prose_or_bullet_tree'
        elif not raw.strip():
            kind = 'blank'
        elif set(raw.strip()) <= {'|', ' '}:
            kind = 'guide'
        elif set(raw.strip()) <= {'='} or set(raw.strip()) <= {'-'}:
            kind = 'border'
        else:
            kind = 'prose'
        accounting.append({'line': number, 'expected_kind': kind, 'actual_kind': parsed_line['kind']})
        if kind != 'ambiguous_prose_or_bullet_tree' and parsed_line['kind'] != kind:
            findings.append({'line': number, 'kind': 'line_classification_mismatch', 'expected': kind, 'actual': parsed_line['kind']})
        if parsed_line['kind'] == 'node':
            assert by_id[parsed_line['node_id']]['line'] == number
        else:
            assert parsed_line['node_id'] is None
    return {
        'id': entry['id'], 'file': entry['source'],
        'input_sha256': hashlib.sha256(source_bytes).hexdigest(),
        'actual_counts': {'nodes': len(actual['nodes']), 'edges': sum(x['parent_id'] is not None for x in actual['nodes']), 'roots': len(actual_roots)},
        'expected_counts': {'nodes': len(expected), 'edges': len(expected) - len(expected_roots), 'roots': len(expected_roots)},
        'expected_root_lines': expected_roots, 'actual_root_lines': actual_roots,
        'verdict': 'fail' if findings else ('ambiguous' if ambiguous_lines else 'pass'),
        'findings': findings, 'ambiguity_lines': ambiguous_lines,
        'parser_exception': entry['exception'], 'strict_diagnostic_failure': entry['strictWouldFail'],
        'diagnostics': actual['diagnostics'],
        'line_accounting': dict(Counter(x['actual_kind'] for x in accounting)),
        'source_line_count': len(lines),
        'verified_common_nodes': len(expected),
        'literal_suffix_verdict': 'ambiguous' if ambiguous_lines else 'pass',
        'literal_label_check': all(x['label'] == (lines[x['line'] - 1][x['column'] - 1:]) for x in actual['nodes']),
    }, {'id': entry['id'], 'source_sha256': hashlib.sha256(source_bytes).hexdigest(), 'nodes': expected,
        'edges_by_source_line': [[x['parent_line'], x['line']] for x in expected if x['parent_line'] is not None],
        'line_accounting': accounting, 'ambiguity_lines': ambiguous_lines,
        'alternative_if_prose_bullets_are_trees': ambiguity_alternative}


if __name__ == '__main__':
    summary = json.loads((BASE / 'parse_summary.json').read_text())
    reviewed, fixtures = [], []
    for entry in summary['entries']:
        result, fixture = audit(entry)
        reviewed.append(result)
        fixtures.append(fixture)
    (BASE / 'independent_expected.json').write_text(json.dumps({'method': __doc__, 'diagrams': fixtures}, indent=2) + '\n')
    (BASE / 'independent_check_results.json').write_text(json.dumps(reviewed, indent=2) + '\n')
    for result in reviewed:
        print(result['id'], result['verdict'], result['actual_counts'], 'expected', result['expected_counts'])
        for finding in result['findings']:
            print(' ', finding)
