"""Builds the tree-comparison report request that visualizes judge anchors. No model calls.
Usage: python3 -I compare-report.py > compare-report.json"""
import json, re, uuid

CELL = '0b3af2dd-ba89-4032-936a-40070a3e167e:1:alternative'
sources = [
  {'id': 'S1', 'label': 'Ghostty S1', 'runId': '3d97670a-8d2d-41fe-86c6-7b3914204965', 'cellKey': CELL, 'revisionId': 'diagram-revision-13e75f09-eb90-4ab7-a063-51736a75eee0'},
  {'id': 'S2', 'label': 'Ghostty S2', 'runId': '87b0635d-e644-43cd-856a-81c73fbc2af6', 'cellKey': CELL, 'revisionId': 'diagram-revision-b5756995-ff07-42eb-9084-1f88aa8f0949'},
  {'id': 'S3', 'label': 'Mapping v2', 'runId': 'df362edd-3c37-49aa-932d-84181ef9d0c2', 'cellKey': CELL, 'revisionId': 'diagram-revision-c450619c-abb4-49c6-aa76-8c9ac6eb24ee'},
  {'id': 'S4', 'label': 'Mapping v4·2', 'runId': 'c3aa93d2-4c2a-4e70-846c-61b571c3607d', 'cellKey': CELL, 'revisionId': 'diagram-revision-c15e40fb-08b9-4e0b-b8c1-9a06f387ad2c'},
]

def r(*pairs): return [{'startLine': a, 'endLine': b} for a, b in pairs]
def m(id, kind, label, A, B, comment, **extra): return {'id': id, 'kind': kind, 'label': label, 'A': r(*A), 'B': r(*B), 'comment': comment, **extra}
def verdict(spec):
  level, why = spec.pop('opinion')
  spec['explanation'] = f"Verdict: {level}. {why}\n\n{spec['explanation']}"
  return spec
def op(level, rationale): return ({'right': 'judge is right', 'wrong': 'judge is wrong', 'debatable': 'debatable'}[level], rationale)

scale = {'kind': 'custom', 'title': 'Did the judge score this correctly?',
  'reason': 'These blocks assess the similarity judge, not a prompt change, so the levels rate the judgement itself.',
  'levels': [
    {'id': 'right', 'label': 'Right', 'meaning': 'The anchors and the score reflect how similar the trees really are.'},
    {'id': 'debatable', 'label': 'Debatable', 'meaning': 'Defensible anchors, but the rubric lets an equally valid reading score differently.'},
    {'id': 'wrong', 'label': 'Wrong', 'meaning': 'The anchors misrepresent the trees, or the rubric penalizes a difference that is not there.'}]}

# ---- Ghostty S1 <-> S2, Astra run 1 (0.928)
ghostty = {'id': 'ghostty-s1-s2', 'title': 'Ghostty S1 ↔ S2 · Astra run 1 · 0.928', 'A': 'S1', 'B': 'S2',
  'explanation': 'Two samples of the same prompt. The judge finds all eight top-level components on both sides, one to one, in the same order, with nothing unmatched. This is the case the rubric is built for and the top-level result is right. The cost sits in two inner levels, and one of those is the formula over-reacting to a small sibling set.',
  'opinion': op('right', 'All eight top-level anchors are correct and no node is left out. 0.93 is a fair score for two runs of the same prompt. The low teardown score is a formula artefact, but it moves the total by only ~0.02.'),
  'steps': [
    {'title': 'Top-level anchors · J = 7.43 / 8 = 0.928', 'root': {'A': 1, 'B': 1},
     'comment': 'Click a match to see the anchors inside it. Eight 1:1 anchors chosen by responsibility and named code (Surface, Termio, StreamHandler, Terminal/ScreenSet, Renderer, resize/config, deinit), not by wording or position. The colours line up in order.',
     'matches': [
       m('runtime', 'same', 'Surface / runtime boundary', [(3, 11)], [(3, 14)], 'Right anchor. s = 0.87. Inner J 0.74 comes from marking the native-callback lines relocated ×0.5, because B repeats session interaction state under Surface.init (B 22–23). Halving a whole child for a 2-line repeat is harsh, but defensible under the rules.'),
       m('assembly', 'same', 'Session assembly and workers', [(13, 20)], [(16, 25)], 'Right. s = 0.92. B adds interaction state and DerivedConfig; A moves Exec.threadEnter here. Different detail, so a small cost.'),
       m('input', 'same', 'Input → child writes', [(22, 34)], [(27, 40)], 'Right. s = 1.00. Keys, mouse, paste and queueIo in both trees.'),
       m('output', 'same', 'Child output → terminal state', [(36, 47)], [(42, 58)], 'Right. s = 1.00, although B nests the Exec/Subprocess launch here and A puts it under assembly. The judge credited it without flagging the ownership difference.'),
       m('terminal', 'same', 'Terminal and screen model', [(49, 62)], [(60, 73)], 'Right. s = 1.00. Same Terminal → ScreenSet → Screen → PageList chain.'),
       m('render', 'same', 'Frame snapshot → GPU', [(64, 76)], [(75, 88)], 'Right. s = 0.97.'),
       m('geometry', 'same', 'Geometry and configuration', [(78, 87)], [(90, 99)], 'Right. s = 0.93.'),
       m('teardown', 'same', 'Session teardown', [(89, 97)], [(101, 109)], 'Not right. s = 0.74, the lowest of the eight, yet the two subtrees describe the same shutdown order. Click to see why: one extra leaf per side halves the level inside.'),
     ]},
  ]}

# ---- Mapping v2 <-> v4·2: three judgements of the same pair
common_tail = [
  m('agent', 'same', 'Agent-assisted editing', [(111, 128)], [(71, 87)], 'Right. Composer, DiagramEditService, canvas bridge and receiver on both sides.'),
  m('persist', 'same', 'Workspace persistence', [(130, 149)], [(89, 104)], 'Right. v4 adds project publication; v2 has more storage detail.'),
]
sol_grouped = {'id': 'mapping-sol-grouped', 'title': 'Mapping v2 ↔ v4·2 · Sol run 2 · 0.862 (grouped)', 'A': 'S3', 'B': 'S4',
  'explanation': 'v2 gives CanvasSession and CanvasHistoryService their own top-level nodes. v4 folds CanvasSession into CanvasWorkspace and nests CanvasHistoryService under MappingDocumentController. This run reads both as grouped: one v4 node against two v2 nodes, counted once, with the cost only inside. This is the reading the rubric intends, and the scores of the other runs should be measured against it.',
  'opinion': op('right', 'Grouping is the right reading of a merge, and it is the only one of the three runs that accounts for every line of both trees at the top level. One caveat: the ownership change for history (top level in v2, under the controller in v4) costs nothing here (inner 0.96), so the score does not reflect it.'),
  'steps': [{'title': 'Top-level anchors · J = 5.17 / 6 = 0.862', 'root': {'A': 1, 'B': 1},
    'comment': 'Click a match to see the anchors inside it. Six anchors, nothing unmatched. The two coloured groups on the left (two v2 nodes each) map onto one v4 node each.',
    'matches': [
      m('ws', 'implied-parent', 'Workspace, ownership and sessions', [(3, 14), (16, 28)], [(3, 14)], 'Right. v4 CanvasWorkspace contains the CanvasSession that v2 draws separately. s = 0.85.', implied={'side': 'A', 'label': 'Workspace + session lifetime'}),
      m('model', 'same', 'Revision-backed canvas model', [(30, 55)], [(16, 30)], 'Right. s = 0.80. v2 keeps MappingCanvasState/view projection here; v4 moves source context and canvas state to presentation.'),
      m('ctrl', 'implied-parent', 'Controller and history', [(57, 75), (77, 95)], [(32, 51)], 'Grouped, s = 0.98. Defensible, but this is a change of owner (history moved under the controller), and the verdict should name it. The score gives it almost no weight.', implied={'side': 'A', 'label': 'Semantic commands + checkpoint history'}),
      m('editor', 'same', 'Editor and inspection surface', [(97, 109)], [(53, 69)], 'Right. Whole branch to whole branch. Source panels exist only in v4, so the cost stays inside: inner 0.48, s = 0.74.'),
      *common_tail]}]}

sol_relocated = {'id': 'mapping-sol-relocated', 'title': 'Mapping v2 ↔ v4·2 · Sol run 1 · 0.757 (relocated)', 'A': 'S3', 'B': 'S4',
  'explanation': 'Same judge, same trees. This time CanvasSession and CanvasHistoryService are anchored separately, to the v4 lines that sit inside other anchors, and marked relocated. The literal rule permits this ("the counterpart exists, but under a different top-level anchor"). The effect is that the v4 lines are counted twice, k goes from 6 to 8, and each extra pair is halved.',
  'opinion': op('wrong', 'The anchors are individually plausible, but together they count v4 lines 9–12 and 40–49 twice and penalize a merge as two relocations. Score drops from 0.862 to 0.757, which is about 0.1 for the same structure. The cause is the overlapping grouped/relocated definitions in the prompt.'),
  'steps': [{'title': 'Top-level anchors · J = 6.05 / 8 = 0.757', 'root': {'A': 1, 'B': 1},
    'comment': 'Click a match to see the anchors inside it. Look at the right-hand side: B 9–12 is coloured by two anchors (workspace and CanvasSession), and B 40–49 by two (controller and history). Those overlaps are what grouped would have avoided.',
    'matches': [
      m('app', 'same', 'Application and canvas workspace', [(3, 14)], [(3, 14)], 'Right on its own. s = 0.80.'),
      m('session', 'relocated', 'CanvasSession', [(16, 28)], [(9, 12)], 'Not right. B 9–12 is already inside the workspace anchor above. Relocated ×0.5 and offset ×0.9 give s = 0.43, and the pair also adds 1 to the denominator.', align=False),
      m('model', 'same', 'Revision-backed canvas model', [(30, 55)], [(16, 30)], 'Right. s = 0.87.'),
      m('ctrl', 'same', 'MappingDocumentController', [(57, 75)], [(32, 51)], 'Right on its own. s = 0.95, but its B range also contains history (B 40–49).'),
      m('history', 'relocated', 'CanvasHistoryService', [(77, 95)], [(40, 49)], 'Not right. Double-counts B 40–49. s = 0.42. The only real difference here is the owner, and grouped plus a note in the verdict would have recorded that.', align=False),
      m('editor', 'same', 'Native editor and presentation', [(97, 109)], [(53, 69)], 'Right. s = 0.82.'),
      *common_tail]}]}

astra_partial = {'id': 'mapping-astra-partial', 'title': 'Mapping v2 ↔ v4·2 · Astra run 2 · 0.739 (partial anchor)', 'A': 'S3', 'B': 'S4',
  'explanation': 'Groups the workspace and controller the same way as Sol run 2, so the first three anchors agree. The difference is the editor: the judge anchors v2’s top-level MappingEditorRuntime to one child of v4’s presentation branch (B 54–59), then lists one other child (B 66–67) as unmatched at the top level. The rest of that branch (B 53, 60–65, 68–69) is not accounted for anywhere.',
  'opinion': op('wrong', 'Same structure as Sol run 2, but 0.12 lower. A top-level node was anchored to part of a branch, and one leftover child became a top-level unmatched item (+1 in the denominator, s = 0). The prompt says ranges cover the whole subtree, but it also allows anchoring one level deeper, and never says what happens to the rest of the branch.'),
  'steps': [{'title': 'Top-level anchors · J = 5.17 / 7 = 0.739', 'root': {'A': 1, 'B': 1},
    'comment': 'Click a match to see the anchors inside it. On the right, only B 54–59 of the presentation branch (B 53–69) is coloured. The marker on the left is the extra unmatched entry that costs ~0.12.',
    'matches': [
      m('ws', 'implied-parent', 'Application, workspace and session lifetime', [(3, 14), (16, 28)], [(3, 14)], 'Right. Same grouping as Sol run 2. s = 0.83.', implied={'side': 'A', 'label': 'Workspace + session lifetime'}),
      m('model', 'same', 'Semantic document model', [(30, 55)], [(16, 30)], 'Right. s = 0.84.'),
      m('ctrl', 'implied-parent', 'Semantic commands and checkpoint history', [(57, 75), (77, 95)], [(32, 51)], 'Right. s = 0.94.', implied={'side': 'A', 'label': 'Semantic commands + checkpoint history'}),
      m('editor', 'depth-shift', 'Native editor runtime', [(97, 109)], [(54, 59)], 'Not right. Anchors to a child of B 53–69 with offset 1. Should be B 53–69 as a whole, with the source panels unmatched inside the pair, where they would cost about 0.13 of one anchor instead of a full top-level slot.'),
      *common_tail],
    'absent': [{'side': 'A', 'afterLine': 109, 'text': 'Judge lists B 66–67 (Source inspection panels, CodeRepoService) as unmatched at the top level: +1 in the denominator. B 53, 60–65 and 68–69 are not counted anywhere.'}]}]}

summary = """These views show the judge's top-level anchors, one colour per anchor, with my assessment on each match and a verdict at the top of each block. Click a top-level match (▸) to see the judge's own anchors one level inside it; lines the judge never accounted for are listed above that view.

**Where the prompt works**
- Finding top-level components by responsibility and named code. On Ghostty all eight anchors are correct and 1:1. On Mapping the three runs agree on five of six components.
- Merges scored as grouped (Sol run 2): one anchor against the union of nodes, with the cost kept inside.

**Where it does not**
1. *Grouped vs relocated overlap.* The same merge is scored as grouped (0.862) or as two relocations that double-count v4 lines (0.757).
2. *Partial anchors.* Anchoring a top-level node to part of a branch pushes the leftovers to the top level as unmatched (0.739).
3. *Small sibling sets.* One extra leaf per side halves a two-pair level (Ghostty teardown, 0.48 inside an almost identical subtree).
4. *Ownership changes are free.* History moving under the controller costs ~0.02 when grouped. The verdict text is the only place it shows up."""
TEARDOWN = 'The weakness here is in the formula, not the anchoring. This level has two pairs, so one unmatched leaf on each side doubles the denominator from 2 to 4. Two one-line differences cost as much here as a missing component costs at the top. Small sibling sets make Jaccard jumpy, and nothing in the rubric weights by subtree size.'

# ---- One level of children per top-level match, taken from the judge's own anchor JSON
TREES = {'S1': '../core-component-eval-2026-11-13/ghostty-astra-high-v4-03/sample-1/diagram.ascii.txt',
  'S2': '../core-component-eval-2026-11-13/ghostty-astra-high-v4-03/sample-2/diagram.ascii.txt',
  'S3': '../core-component-eval-2026-11-13/astra-high-8ca1437/diagram.ascii.txt',
  'S4': '../core-component-eval-2026-11-13/mapping-astra-high-v4-02/sample-2/diagram.ascii.txt'}
NODE = re.compile(r'^((?:[|`\s] {3})*)[|`]-- ')
def depth(text, n):
  if n == 1: return 0
  g = NODE.match(text); return len(g.group(1)) // 4 + 1 if g else None
def fmt(rs): return ', '.join(f"{a}" if a == b else f"{a}–{b}" for a, b in rs)
def dropped(lines, parent_ranges, covered, direct):
  """Direct child nodes of the parent whose subtree no child pair or unmatched entry touches."""
  out = []
  for start, end in parent_ranges:
    d0 = depth(lines[start - 1], start)
    # A grouped side whose child is this whole node has nothing dropped at this level.
    if d0 is None or any(a == start for a, b in direct): continue
    n = start + 1
    while n <= end:
      if depth(lines[n - 1], n) == d0 + 1:
        e = n
        while e + 1 <= end and (depth(lines[e], e + 1) is None or depth(lines[e], e + 1) > d0 + 1): e += 1
        while e > n and not lines[e - 1].strip('|` '): e -= 1
        label = lines[n - 1].split('-- ', 1)[-1].strip()
        is_path = re.match(r'^(Sources?:|src/|domain/|application/|infrastructure/)', label) or ('/' in label and ' ' not in label)
        # Ancestor ranges start at or above the parent line; anything else overlapping the node covers it.
        if not is_path and not any(start < a <= e and b >= n for a, b in covered): out.append((n, e, label[:70]))
        n = e + 1
      else: n += 1
  return out
def kind_of(p):
  if p['relocated']: return 'relocated', None
  if len(p['a']) > 1 or len(p['b']) > 1:
    side = 'A' if len(p['a']) >= len(p['b']) else 'B'
    return 'implied-parent', {'side': side, 'label': f"Several {side} nodes, one {'B' if side == 'A' else 'A'} node"}
  return ('depth-shift', None) if p['offset'] else ('same', None)
def inner_text(i):
  if i == 'leaves': return 'both leaves'
  if i == 'summarized': return 'summarized: only one side has children'
  return f"inner J {i['J']:.2f} ({len(i['pairs'])} pairs, {len(i['unmatchedA'])} only in A, {len(i['unmatchedB'])} only in B)"
def everywhere(level, key, um):
  """Every range the judge used anywhere on one side, so lines placed elsewhere are not reported as dropped."""
  got = [tuple(u['lines']) for u in level[um]]
  for c in level['pairs']:
    got += [tuple(x) for x in c[key]]
    if isinstance(c['inner'], dict): got += everywhere(c['inner'], key, um)
  return got
def attach(spec, judge, notes={}):
  out = json.load(open(f'jobs/{judge}/judge.json'))['anchors']
  text = {s: open(TREES[spec[s]]).read().split('\n') for s in ('A', 'B')}
  step = spec['steps'][0]
  assert len(step['matches']) == len(out['pairs']), spec['id']
  for i, (match, pair) in enumerate(zip(step['matches'], out['pairs'])):
    assert [[x['startLine'], x['endLine']] for x in match['A']] == pair['a'] and [[x['startLine'], x['endLine']] for x in match['B']] == pair['b'], (spec['id'], i)
    inner = pair['inner']
    if not isinstance(inner, dict): continue
    children = []
    for k, c in enumerate(inner['pairs']):
      kind, implied = kind_of(c)
      children.append({'id': f'c{k + 1}', 'kind': kind, 'label': c['label'][:120], 'A': r(*sorted(c['a'])), 'B': r(*sorted(c['b'])),
        **({'implied': implied} if implied else {}), **({'align': False} if kind == 'relocated' else {}),
        'comment': (f"s = {c['s']:.2f} · {inner_text(c['inner'])}" + (f" · depth offset {c['offset']}" if c['offset'] else '') + (f". {notes[(i, k)]}" if (i, k) in notes else ''))[:2000]})
    absent = [{'side': 'B', 'afterLine': match['B'][-1]['endLine'], 'text': f"Only in A {fmt([u['lines']])}: {u['label']}"[:300]} for u in inner['unmatchedA']] + \
             [{'side': 'A', 'afterLine': match['A'][-1]['endLine'], 'text': f"Only in B {fmt([u['lines']])}: {u['label']}"[:300]} for u in inner['unmatchedB']]
    parts = [notes[(i, None)]] if (i, None) in notes else []
    parts.append(f"Judge's level J = {inner['J']:.3f} = Σs / (pairs + unmatched) = {sum(c['s'] for c in inner['pairs']):.2f} / {len(inner['pairs']) + len(inner['unmatchedA']) + len(inner['unmatchedB'])}.")
    for s, key, um in (('A', 'a', 'unmatchedA'), ('B', 'b', 'unmatchedB')):
      covered = everywhere(out, key, um)
      direct = [tuple(x) for c in inner['pairs'] for x in c[key]] + [tuple(u['lines']) for u in inner[um]]
      miss = dropped(text[s], pair[key], covered, direct)
      if miss: parts.append(f"Not accounted for by the judge in {s} (neither paired nor unmatched, so they never reach the denominator): " + '; '.join(f"{s} {fmt([(a, b)])} {t}" for a, b, t in miss) + '.')
    match['children'] = {'comment': ' '.join(parts)[:5000], 'matches': children[:40], **({'absent': absent[:20]} if absent else {})}
  return spec

attach(ghostty, 'astra-high-judge/ghostty-1-2/1', {(7, None): TEARDOWN})
attach(sol_grouped, 'sol-high-judge/mapping-v2-v4b/2')
attach(sol_relocated, 'sol-high-judge/mapping-v2-v4b/1')
attach(astra_partial, 'astra-high-judge/mapping-v2-v4b/2/attempt-2')

pages = [
  {'id': 'overview', 'title': 'Overview', 'blocks': [{'kind': 'text', 'text': summary}]},
  {'id': 'ghostty', 'title': 'Ghostty S1 ↔ S2 · works', 'blocks': [{'kind': 'compare-tree', 'spec': verdict(ghostty)}]},
  {'id': 'mapping', 'title': 'Mapping v2 ↔ v4·2 · three readings', 'blocks': [
    {'kind': 'text', 'text': 'One pair of trees, three judgements. Compare the right-hand side across the three blocks: the first colours every v4 branch once; the second colours two stretches twice; the third leaves most of the presentation branch uncoloured.'},
    {'kind': 'compare-tree', 'spec': verdict(sol_grouped)}, {'kind': 'compare-tree', 'spec': verdict(sol_relocated)}, {'kind': 'compare-tree', 'spec': verdict(astra_partial)}]},
]

print(json.dumps({'requestId': str(uuid.uuid5(uuid.NAMESPACE_URL, 'tree-similarity-judge/anchor-views/v2')),
  'title': 'Similarity judge · top-level anchors: where prompt v1 scores well and where it does not',
  'experimentId': 'ec6457e2-7b98-4f0a-847e-c0adba745c83',
  'evaluator': {'model': 'claude-opus-5-5', 'effort': 'high'},
  'sources': sources, 'pages': pages}, ensure_ascii=False, indent=1))
