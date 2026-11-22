"""Scoring walkthrough on one judgement (Ghostty S1 <-> S2, Astra run 1), told through match comments. No model calls.
Usage: python3 -I walkthrough.py > walkthrough.json"""
import json, uuid

CELL = '0b3af2dd-ba89-4032-936a-40070a3e167e:1:alternative'
anchors = json.load(open('jobs/astra-high-judge/ghostty-1-2/1/judge.json'))['anchors']
def r(rs): return [{'startLine': a, 'endLine': b} for a, b in rs]

top_comments = {
  7: 'STEP 1 — click me. s = 0.74, the lowest of the eight, though both sides describe the same shutdown. '
     'Rule: s = 0.5 + 0.5 × inner, where inner is the J of the level inside. Inside, J = 0.48, so s = 0.5 + 0.5 × 0.48 = 0.74. '
     'The 0.5 is a floor: a matched pair never scores below 0.5, however different its insides are. Open it to see where 0.48 comes from.',
}
def top_comment(i, p):
  if i in top_comments: return top_comments[i]
  inner = p['inner']
  return f"s = 0.5 + 0.5 × {inner['J']:.2f} (J inside) = {p['s']:.2f}." if isinstance(inner, dict) else f"s = {p['s']:.2f}."

labels = ['Surface / runtime boundary', 'Session assembly and workers', 'Input → child writes', 'Child output → terminal state',
          'Terminal and screen model', 'Frame snapshot → GPU', 'Geometry and configuration', 'Session teardown']
matches = []
for i, p in enumerate(anchors['pairs']):
  m = {'id': f't{i + 1}', 'kind': 'same', 'label': labels[i], 'A': r(p['a']), 'B': r(p['b']), 'comment': top_comment(i, p)}
  if i == 7:
    m['children'] = {
      'comment': 'STEP 2 — this level’s J. Every level is scored the same way: J = (sum of the pair scores) / (number of pairs + number of unmatched nodes on either side). '
                 'Here: two pairs, scoring 1.00 and 0.935, and two unmatched nodes (the dashed markers), each scoring 0 but still counted below the line. '
                 'J = (1.00 + 0.935) / (2 + 1 + 1) = 1.935 / 4 = 0.48. '
                 'That is the Jaccard part: shared things go on top, everything either side has goes underneath, so anything one-sided dilutes the level. '
                 'Read the two pairs (STEP 3, STEP 4), then the markers (STEP 5), then go ← Top level for STEP 6.',
      'matches': [
        {'id': 'close', 'kind': 'same', 'label': 'Runtime-managed close', 'A': r([[91, 91]]), 'B': r([[102, 102]]),
         'comment': 'STEP 3 — the simplest case. One line each side, no children on either: inner = 1 by definition ("leaves"). '
                    'No depth offset (×1), not relocated (×1). s = 1 × (0.5 + 0.5 × 1) × 1 = 1.00.'},
        {'id': 'deinit', 'kind': 'implied-parent', 'label': 'Surface.deinit resource release', 'A': r([[92, 97]]), 'B': r([[103, 104], [105, 106], [107, 107]]),
         'implied': {'side': 'B', 'label': 'Surface.deinit (a parent in A, implied in B)'},
         'comment': 'STEP 4 — grouped, with a level hidden below. A draws Surface.deinit as one parent (92–97); B lists the same steps as three siblings (103–107). '
                    'Grouped means it counts as ONE pair here, so B’s split costs nothing at this level. Its inner J = 0.87 comes from the level below (not shown): '
                    'stop/join workers 0.90, renderer/IO ordering 0.81, release resources 0.90 → (0.90 + 0.81 + 0.90) / 3 = 0.87. '
                    'Each is 0.9 not 1 because B’s steps sit one level higher than A’s: depth offset 1 → × 0.9. Renderer/IO is also "summarized" '
                    '(A has two lines, B one node with a child → inner 0.8), so 0.9 × (0.5 + 0.5 × 0.8) = 0.81. '
                    'Back up here: s = 0.5 + 0.5 × 0.87 = 0.935.'},
      ],
      'absent': [
        {'side': 'B', 'afterLine': 109, 'text': 'STEP 5 — only in A 90: child exit → hold/close. Scores 0, adds 1 to the denominator.'},
        {'side': 'A', 'afterLine': 97, 'text': 'STEP 5 — only in B 108–109: App.deinit frees shared fonts/device. Scores 0, adds 1 to the denominator.'},
      ]}
  matches.append(m)

step_comment = ('HOW TO READ: start at STEP 1 on Session teardown (▸), click it, and follow the numbers. '
  'STEP 6 (the top level): the final score is the same J formula one more time. 8 pairs, nothing unmatched: '
  'J = (0.87 + 0.92 + 1.00 + 1.00 + 1.00 + 0.97 + 0.93 + 0.74) / 8 = 7.43 / 8 = 0.928. '
  'WHY IT’S UNEXPECTED: two one-line leaves halved the teardown level (0.97 → 0.48), but that only moves the total by 0.03 (0.958 → 0.928), '
  'because each level passes on only half its difference (the 0.5 floor) and teardown is 1 of 8. '
  'Compare: one extra unmatched top-level component would cost 0.10 (7.43 / 9 = 0.825). '
  'So the size of a penalty depends on how many siblings share the level and how deep it is, not on how much of the tree differs.')

spec = {'id': 'teardown-walkthrough', 'title': 'Scoring walkthrough · Ghostty S1 ↔ S2 · Session teardown', 'A': 'S1', 'B': 'S2',
  'explanation': 'The judge’s own anchors for Astra run 1 (score 0.928). The comments on each match walk through the scoring, numbered in reading order. '
                 'Cards clip long comments: hover a card, or open “Match notes” under the trees, to read one in full.',
  'steps': [{'title': 'Top level · J = 7.43 / 8 = 0.928', 'root': {'A': 1, 'B': 1}, 'comment': step_comment, 'matches': matches}]}

formula = """**The whole scheme is two rules, applied from the bottom of the tree up.**

1. **A level** (a set of sibling nodes being compared): `J = sum of pair scores / (pairs + unmatched nodes on either side)`. Unmatched nodes score 0 but count underneath.
2. **A pair** (one anchor): `s = 0.9^offset × (0.5 + 0.5 × inner) × (0.5 if relocated)`, where *inner* is the J of the level inside the pair.
   - *inner* = 1 if both sides are leaves, 0.8 if only one side has children (summarized).
   - *offset* = how many levels deeper the node sits on one side than the other.

The final score is J at the top level. The view below follows one match through both rules."""

print(json.dumps({'requestId': str(uuid.uuid5(uuid.NAMESPACE_URL, 'tree-similarity-judge/scoring-walkthrough/v1')),
  'title': 'Similarity judge · scoring walkthrough (Ghostty teardown)', 'experimentId': 'ec6457e2-7b98-4f0a-847e-c0adba745c83',
  'evaluator': {'model': 'claude-opus-5-5', 'effort': 'high'},
  'sources': [
    {'id': 'S1', 'label': 'Ghostty S1', 'runId': '3d97670a-8d2d-41fe-86c6-7b3914204965', 'cellKey': CELL, 'revisionId': 'diagram-revision-13e75f09-eb90-4ab7-a063-51736a75eee0'},
    {'id': 'S2', 'label': 'Ghostty S2', 'runId': '87b0635d-e644-43cd-856a-81c73fbc2af6', 'cellKey': CELL, 'revisionId': 'diagram-revision-b5756995-ff07-42eb-9084-1f88aa8f0949'}],
  'pages': [{'id': 'walkthrough', 'title': 'Scoring walkthrough', 'blocks': [{'kind': 'text', 'text': formula}, {'kind': 'compare-tree', 'spec': spec}]}]},
  ensure_ascii=False, indent=1))
