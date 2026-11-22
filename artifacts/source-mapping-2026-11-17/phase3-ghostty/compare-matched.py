"""Descriptive comparisons on exactly matching case/repeat slots; no model calls."""
import json
from pathlib import Path
from statistics import mean

here = Path(__file__).resolve().parent
analysis = json.loads((here / 'analysis.json').read_text())
functions = json.loads((here / 'function-comparison.json').read_text())
samples = [s for s in analysis['samples'] if s['status'] == 'finished']

def summarize(items):
    keys = {s['key'] for s in items}
    observations = [r for r in functions['details'] if r['key'] in keys]
    return {
        'samples': len(items),
        'meanUniqueSourceLines': mean(s['uniqueSourceLines'] for s in items),
        'meanElapsedSeconds': mean(s['elapsedSeconds'] for s in items),
        'meanTotalTokens': mean(s['usage']['totalTokens'] for s in items),
        'mappedNodes': sum(s['mappedNodes'] for s in items),
        'nodes': sum(s['nodes'] for s in items),
        'fullDefinitions': sum(r['fullDefinition'] for r in observations),
        'functionObservations': len(observations),
        'fullDefinitionRate': mean(r['fullDefinition'] for r in observations),
    }

comparisons = []
for condition in sorted({s['condition'] for s in samples if s['phase'] == 'phase-3'}):
    current = [s for s in samples if s['condition'] == condition]
    slots = {(s['caseId'], s['sample']) for s in current}
    baselines = {}
    for baseline in ['sol-medium_baseline', 'sol-high_baseline']:
        matched = [s for s in samples if s['condition'] == baseline and (s['caseId'], s['sample']) in slots]
        assert len(matched) == len(current)
        baselines[baseline] = summarize(matched)
    comparisons.append({'condition': condition, 'slots': sorted(slots), 'current': summarize(current), 'baselines': baselines})
report = {
    'method': 'Exclude failed Phase 3 slots and their matching baseline case/repeat slots. Pairing identifies input/repeat slots, not shared random seeds. Descriptive only; prompt and delegation changed together, and Astra also changes the lead model. Failed-attempt usage is excluded from per-success means and reported separately.',
    'comparisons': comparisons,
}
(here / 'matched-comparison.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
