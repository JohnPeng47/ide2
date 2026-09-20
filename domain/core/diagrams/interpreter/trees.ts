import { decision, unresolved } from './layout';
import type { DiagramInterpretation, DiagramNode, Label, Region, WireCell } from './types';

function addNode(result: DiagramInterpretation, label: Label, region: Region, kind: DiagramNode['kind']): DiagramNode {
  if (result.nodes.length >= result.policy.maxNodes) throw new RangeError('Diagram exceeds maxNodes');
  const id = `node-${label.span.line}-${label.span.column}`;
  const node: DiagramNode = { id, kind, label: label.text, regionId: region.id,
    spans: [label.span], ...(label.anchor !== undefined ? { branchColumn: label.anchor } : {}), childIds: [],
    decisionIds: [decision(result, 'positioned-label', 'A label occurrence identifies this node.', [label.span],
      label.branch ? [label.branch.id] : [])] };
  label.node = node;
  result.nodes.push(node);
  region.nodeIds.push(id);
  result.lines[label.span.line - 1].kind = 'node';
  result.lines[label.span.line - 1].nodeIds.push(id);
  return node;
}
function region(result: DiagramInterpretation): Region {
  const entry: Region = { id: `region-${result.regions.length}`, kind: 'text', rootIds: [], nodeIds: [] };
  result.regions.push(entry);
  return entry;
}
function attach(result: DiagramInterpretation, node: DiagramNode, parent?: DiagramNode) {
  const owner = result.regions.find(r => r.id === node.regionId)!;
  if (!parent) { owner.rootIds.push(node.id); return; }
  const id = decision(result, 'tree-ancestry', 'The nearest shallower branch in this region is the parent.',
    [...parent.spans, ...node.spans]);
  node.parentId = parent.id;
  node.decisionIds.push(id);
  parent.childIds.push(node.id);
  result.edges.push({ id: `contains-${node.id}`, kind: 'contains', from: parent.id, to: node.id, decisionId: id });
}

function plainHasChildren(label: Label, next?: Label): boolean {
  return Boolean(next?.branch && next.block === label.block && next.anchor! >= label.column);
}

function treeDocument(result: DiagramInterpretation, labels: Label[]): void {
  const { policy } = result;
  let owner: Region | undefined;
  let stack: { anchor: number; node: DiagramNode }[] = [];
  let block = -1;
  let prose = false;
  let seenBranch = false;
  let previous: Label | undefined;
  const marked = new Set(labels.filter(l => l.branch).map(l => l.block));
  const branchTop = new Map<number, number>();
  for (const l of labels.filter(l => l.branch && !l.branch.bullet)) branchTop.set(l.block, Math.min(branchTop.get(l.block) ?? Infinity, l.anchor!));
  for (const [index, label] of labels.entries()) {
    if (label.block !== block) { block = label.block; stack = []; owner = undefined; prose = false; seenBranch = false; previous = undefined; }
    if (label.uncertain) {
      const textRegion = region(result);
      const node = addNode(result, label, textRegion, 'text');
      textRegion.rootIds.push(node.id);
      result.lines[label.span.line - 1].kind = 'unresolved';
      stack = []; owner = undefined; previous = label;
      continue;
    }
    const next = labels[index + 1];
    let childAhead = plainHasChildren(label, next);
    const blankGap = previous && result.source.rows.slice(previous.span.line, label.span.line - 1).some(r => r.kind === 'blank');
    const rootColumn = stack[0]?.node.spans[0].column ?? 1;
    if (policy.detachedLists === 'auto' && seenBranch && blankGap && !label.branch && next?.branch?.bullet &&
      next.anchor! <= (branchTop.get(block) ?? 0)) {
      prose = true; childAhead = false;
    }
    const excludedBullet = policy.detachedLists === 'auto' && label.branch?.bullet && seenBranch &&
      label.anchor! <= (branchTop.get(block) ?? 0) && (blankGap || prose);
    if (excludedBullet) { prose = true; result.lines[label.span.line - 1].kind = 'prose'; continue; }
    if (label.branch?.bullet && previous?.branch && !previous.branch.bullet &&
      label.span.line > previous.span.line + 1 && label.anchor! <= rootColumn) {
      stack = []; owner = undefined;
    }
    if (!label.branch) {
      if (policy.compatibility) {
        // Legacy arrow-tree titles never become structural roots.
        const intervening = next ? result.source.rows.slice(label.span.line, next.span.line - 1) : [];
        const legacyRoot = label.column === 1 && childAhead && !next?.branch?.headed &&
          intervening.every(r => /^[| ]+$/.test(r.text));
        if (!legacyRoot) { result.lines[label.span.line - 1].kind = 'prose'; continue; }
      } else {
        const proseLike = /^(?:#{1,6}\s|here(?:'s| is| are)\b|below\b|the (?:following|tree|diagram)\b|(?:notes?|legend|notation|scope|explanation|key|relationships)(?:\s*:|$))/i.test(label.text);
        if (!childAhead && marked.has(block) && (proseLike || prose || label.column <= rootColumn)) {
          result.lines[label.span.line - 1].kind = 'prose'; prose ||= label.column <= rootColumn; continue;
        }
        const last = stack.at(-1);
        const aligned = last && label.column === last.node.spans[0].column;
        const hanging = last && label.column >= last.node.spans[0].column && /[/,\\]$/.test(last.node.label);
        const join = marked.has(block) && !childAhead && last && policy.continuation !== 'separate' &&
          (aligned || hanging || policy.continuation === 'join' && label.column > last.anchor);
        if (join) {
          last.node.label += ' ' + label.text;
          last.node.spans.push(label.span);
          label.node = last.node;
          last.node.decisionIds.push(decision(result, 'label-continuation', `The ${policy.continuation} continuation policy joins this line.`, [label.span]));
          result.lines[label.span.line - 1] = { line: label.span.line, kind: 'continuation', nodeIds: [last.node.id] };
          continue;
        }
      }
      if (childAhead && (!stack.length || label.column <= rootColumn)) { stack = []; owner = undefined; }
    }
    if (!owner) { owner = region(result); owner.kind = 'tree'; }
    const anchor = label.anchor ?? (childAhead ? Math.min(label.column, next!.anchor!) - 1 : label.column);
    while (stack.length && stack.at(-1)!.anchor >= anchor) stack.pop();
    const node = addNode(result, label, owner, 'tree-item');
    attach(result, node, stack.at(-1)?.node);
    stack.push({ anchor, node });
    if (label.branch && !label.branch.bullet) seenBranch = true;
    prose = false;
    previous = label;
  }
}

/** Region ownership and ancestry are separate: an outer tree can resume after an embedded tree. */
function graphDocument(result: DiagramInterpretation, labels: Label[], wires: WireCell[]): void {
  const groups = new Map<Region, Label[]>();
  let active: { column: number; owner: Region }[] = [];
  let block = -1;
  const wireRows = new Set(wires.filter(w => w.glyph !== 'vertical').map(w => w.line));
  for (const [index, label] of labels.entries()) {
    if (label.block !== block) { active = []; block = label.block; }
    const below = result.source.rows[label.span.line];
    const afterRule = labels[index + 1];
    if (!label.branch && below && /^[ =_\-]+$/.test(below.text) && below.text.trim() &&
      !(afterRule?.branch && afterRule.span.line === label.span.line + 2)) {
      result.lines[label.span.line - 1].kind = 'prose'; continue;
    }
    let owner: Region;
    if (!label.branch) {
      const prior = [...groups.entries()].at(-1);
      const last = prior?.[1].at(-1);
      if (prior && !label.uncertain && !last?.uncertain && prior[0].kind === 'text' && last?.block === block && last.span.line + 1 === label.span.line &&
        last.column === label.column && !wireRows.has(last.span.line) && !wireRows.has(label.span.line)) {
        owner = prior[0];
      } else {
        owner = region(result);
        active = active.filter(entry => entry.column < label.column);
        active.push({ column: label.column, owner });
      }
    } else {
      const options = active.filter(entry => entry.column <= label.anchor! + result.policy.treeTolerance)
        .sort((a, b) => b.column - a.column);
      owner = options[0]?.owner ?? region(result);
      if (!options.length) active.push({ column: label.anchor!, owner });
      const previous = groups.get(owner)?.at(-1);
      if (previous?.anchor !== undefined && label.anchor! < previous.anchor) {
        active = active.filter(entry => entry.column <= label.anchor! ||
          (groups.get(entry.owner)?.[0].span.line ?? 0) <= previous.span.line);
      }
      owner.kind = 'tree';
    }
    groups.set(owner, [...(groups.get(owner) ?? []), label]);
  }
  for (const [owner, items] of groups) {
    if (owner.kind === 'text') {
      const node = addNode(result, items[0], owner, 'text');
      for (const l of items.slice(1)) {
        node.label += '\n' + l.text; node.spans.push(l.span); l.node = node;
        result.lines[l.span.line - 1] = { line: l.span.line, kind: 'continuation', nodeIds: [node.id] };
      }
      owner.rootIds.push(node.id); continue;
    }
    const anchors = new Map<number, number>();
    for (const item of items) if (item.anchor !== undefined) anchors.set(item.anchor, (anchors.get(item.anchor) ?? 0) + 1);
    const canonical = new Map<number, number>();
    const ambiguous = new Set<number>();
    const levels = [...anchors.keys()].sort((a, b) => a - b);
    for (let i = 0; i < levels.length;) {
      const group = [levels[i++]];
      while (i < levels.length && levels[i] - group[0] <= result.policy.treeTolerance &&
        !items.some(l => l.anchor === levels[i] && l.guides.some(g => group.includes(g)))) group.push(levels[i++]);
      const ranked = [...group].sort((a, b) => anchors.get(b)! - anchors.get(a)! || a - b);
      const unique = group.length === 1 || anchors.get(ranked[0])! > anchors.get(ranked[1])!;
      for (const col of group) {
        canonical.set(col, unique && result.policy.repairs !== 'none' ? ranked[0] : col);
        if (!unique && result.policy.repairs !== 'none') ambiguous.add(col);
      }
    }
    const base = Math.min(...canonical.values());
    const stack: { anchor: number; node: DiagramNode }[] = [];
    for (const label of items) {
      const old = label.anchor;
      let anchor = old === undefined ? Math.min(label.column, base) - 1 : canonical.get(old)!;
      if (old !== undefined && anchor !== old) {
        const row = result.source.rows[label.span.line - 1];
        const delta = anchor - old;
        const newEnd = label.span.endColumn + delta;
        const crossed = delta < 0 ? row.text.slice(anchor - 1, old - 1) : row.text.slice(label.span.endColumn - 1, newEnd - 1);
        if (crossed.trim()) {
          unresolved(result, 'blocked-tree-repair', 'Aligning this branch would cross existing drawing content.', [label.span],
            [{ description: 'Keep the original indentation.' }]);
          anchor = old;
        }
      }
      const node = addNode(result, label, owner, 'tree-item');
      if (old !== undefined && anchor !== old) {
        const id = `repair-${result.repairs.length}`;
        result.repairs.push({ id, kind: 'tree-alignment', reason: 'A uniquely dominant nearby branch column establishes the alignment.',
          spans: [label.branch!.span], moves: [{ line: label.span.line, column: old, toColumn: anchor }], changesStructure: true });
        node.decisionIds.push(decision(result, 'tree-alignment', 'Explicit guides protect nested levels; the remaining drift matches the dominant column.',
          items.filter(l => l.anchor === anchor || l === label).map(l => l.span), [], [id]));
      }
      if (old !== undefined && ambiguous.has(old) && stack.length && old > stack.at(-1)!.anchor && old - stack.at(-1)!.anchor <= result.policy.treeTolerance) {
        unresolved(result, 'ambiguous-indentation', 'This indentation can be a child level or alignment drift.', [label.span],
          [{ description: 'Child of preceding item', nodeIds: [stack.at(-1)!.node.id] },
            { description: 'Sibling of preceding item', nodeIds: stack.at(-1)!.node.parentId ? [stack.at(-1)!.node.parentId!] : [] }]);
        stack.length = 0;
      }
      while (stack.length && stack.at(-1)!.anchor >= anchor) stack.pop();
      attach(result, node, stack.at(-1)?.node);
      stack.push({ anchor, node });
    }
  }
  result.nodes.sort((a, b) => a.spans[0].line - b.spans[0].line || a.spans[0].column - b.spans[0].column);
}

export function interpretTrees(result: DiagramInterpretation, labels: Label[], wires: WireCell[]): void {
  if (result.policy.dialect === 'tree') treeDocument(result, labels);
  else graphDocument(result, labels, wires);
}
