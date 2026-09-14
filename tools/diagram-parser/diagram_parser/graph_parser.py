#!/usr/bin/env python3
"""Extract local trees and text regions, then trace headed ASCII references.

Coordinates in public results are one-based. Occurrences, not names, identify
nodes. This deliberately regular grammar requires headed reference connectors;
short arrows inside balanced brackets/parentheses/braces remain literal text.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass, field
import json
from pathlib import Path
import re
import sys

try:
    from .tree_parser import Diagnostic, ParseResult, parse_tree
except ImportError:
    from tree_parser import Diagnostic, ParseResult, parse_tree


@dataclass
class Span:
    line: int
    column: int
    text: str
    branch_column: int | None = None
    marker: str = ""
    node_id: int = -1
    tree_node_id: int | None = None
    cleaned_column: int = 0
    cleaned_branch_column: int | None = None
    guide_columns: list[int] = field(default_factory=list)


@dataclass
class GraphNode:
    id: int
    kind: str
    text: str
    spans: list[Span] = field(default_factory=list)
    tree: ParseResult | None = None


@dataclass(frozen=True)
class Endpoint:
    node_id: int
    tree_node_id: int | None = None


@dataclass
class Reference:
    source: Endpoint
    target: Endpoint
    arrow_line: int
    arrow_column: int
    wire_cells: list[tuple[int, int]]


@dataclass
class Repair:
    line: int
    column: int
    cleaned_column: int
    text: str
    kind: str


@dataclass
class GraphResult:
    nodes: list[GraphNode]
    references: list[Reference]
    diagnostics: list[Diagnostic]
    repairs: list[Repair]
    original_ascii: str
    cleaned_ascii: str

    def to_dict(self) -> dict:
        return asdict(self)

    def render(self) -> str:
        return self.cleaned_ascii


class GraphParseError(ValueError):
    def __init__(self, result: GraphResult):
        self.result = result
        super().__init__("; ".join(d.message for d in result.diagnostics))


# A route may start with a tree-looking elbow, but an arrow or terminal corner
# makes the entire run a reference, never a containment branch.
_ROUTE = re.compile(r"(?:[<←]|[`\\+])?[-─━═]+(?:[+┐┘|│][-─━═]+)*[+┐┘>→]?")
_BRANCH = re.compile(r"[|+`\\├└┣┗╰][-─━═]+[ ]*")
_VERT = "|+`\\v^│┐┘↓↑"
_ARROWS = "><v^←→↓↑"


def _is_route(match: re.Match | None) -> bool:
    return bool(match and (match[0][-1] in "+┐┘>→" or match[0][0] in "<←"))


def _scan(lines: list[str], wire_tolerance: int = 2) -> tuple[list[Span], dict[tuple[int, int], str], set[int]]:
    spans: list[Span] = []
    wires: dict[tuple[int, int], str] = {}
    ignored: set[int] = set()
    for y, row in enumerate(lines):
        if (not row.strip() or row.lstrip().startswith("```")
                or re.fullmatch(r"[ =_\-]+", row)
                or (y + 1 < len(lines) and re.fullmatch(r"[ =_\-]+", lines[y + 1])
                    and lines[y + 1].strip()
                    and not (y + 2 < len(lines) and _BRANCH.match(lines[y + 2].lstrip())))):
            ignored.add(y)
            continue
        x = 0
        marker = ""
        anchor = None
        while x < len(row):
            if row[x] == " ":
                x += 1
                continue
            route = _ROUTE.match(row, x)
            if _is_route(route):
                for k in range(x, route.end()):
                    wires[y, k] = row[k]
                x = route.end()
                continue
            branch = _BRANCH.match(row, x)
            if branch:
                marker = branch[0].rstrip()
                anchor = x
                x = branch.end()
                continue
            if row[x] in "|│" or (row[x] in "v^↓↑" and
                    (x + 1 == len(row) or row[x + 1] == " ")):
                wires[y, x] = row[x]
                x += 1
                continue
            start = x
            closing: list[str] = []
            while x < len(row):
                ch = row[x]
                if ch in "[{(":
                    closing.append({"[": "]", "{": "}", "(": ")"}[ch])
                elif closing and ch == closing[-1]:
                    closing.pop()
                if not closing:
                    if row.startswith("   ", x):
                        break
                    if ch in "|│" and re.fullmatch(r"[ |│]+", row[x:]):
                        # A crowded label may leave just one space before a
                        # routed vertical wire. Require neighboring wire evidence.
                        if any(lines[other][k] in "|│+" for other in (y - 1, y + 1)
                               if 0 <= other < len(lines)
                               for k in range(max(0, x - wire_tolerance),
                                              min(len(lines[other]), x + wire_tolerance + 1))):
                            break
                    candidate = _ROUTE.match(row, x)
                    if _is_route(candidate):
                        break
                x += 1
            label = row[start:x].rstrip()
            if label:
                guides = [k + 1 for k, ch in enumerate(row[:anchor]) if ch in "|│"] if anchor is not None else []
                spans.append(Span(y + 1, start + 1, label,
                                  anchor + 1 if anchor is not None else None, marker,
                                  guide_columns=guides))
            marker, anchor = "", None
            if x == start:  # Defensive progress for an unsupported connector.
                x += 1
    # Tree guides are not graph wires. Remove prefixes before a local branch,
    # including guides on rows carrying an adjacent tree on the right.
    row_pipes: dict[int, list[tuple[int, int]]] = defaultdict(list)
    for pos, ch in wires.items():
        if ch in "|│":
            row_pipes[pos[0]].append(pos)
    for span in spans:
        if span.branch_column is not None:
            y, anchor = span.line - 1, span.branch_column - 1
            for pos in row_pipes[y]:
                if pos in wires and pos[1] < anchor:
                    # A right-hand tree must not claim an intervening graph wire.
                    if all(ch in " |│" for ch in lines[y][:pos[1] + 1]):
                        del wires[pos]
    return spans, wires, ignored


def _partition(spans: list[Span], tolerance: int, wires: dict) -> list[GraphNode]:
    nodes: list[GraphNode] = []
    active: dict[int, GraphNode] = {}
    for span in spans:
        if span.branch_column is None:
            node = GraphNode(len(nodes), "text", span.text)
            nodes.append(node)
            # A new left-hand root starts a new set of neighboring regions.
            active = {col: other for col, other in active.items() if col < span.column}
            active[span.column] = node
        else:
            choices = [(col, node) for col, node in active.items()
                       if col <= span.branch_column + tolerance]
            if choices:
                _, node = max(choices, key=lambda pair: (pair[0], pair[1].id))
                previous = node.spans[-1]
                if previous.branch_column is not None and span.branch_column < previous.branch_column:
                    # An outer tree resuming at a shallower branch closes regions
                    # introduced since its preceding branch. Existing parallel
                    # trees, which started earlier, remain available.
                    active = {col: other for col, other in active.items()
                              if col <= span.branch_column
                              or other.spans[0].line <= previous.line}
            else:
                node = GraphNode(len(nodes), "tree", span.text)
                nodes.append(node)
                active[span.branch_column] = node
            node.kind = "tree"
        span.node_id = node.id
        node.spans.append(span)
    merged: list[GraphNode] = []
    for node in nodes:
        previous = merged[-1] if merged else None
        if (previous and previous.kind == node.kind == "text"
                and previous.spans[-1].line + 1 == node.spans[0].line
                and previous.spans[-1].column == node.spans[0].column
                and not any(ch in "-─━═<>←→" and y + 1 in
                            (previous.spans[-1].line, node.spans[0].line)
                            for (y, _), ch in wires.items())):
            previous.text += "\n" + node.text
            previous.spans.extend(node.spans)
        else:
            node.id = len(merged)
            merged.append(node)
    for node in merged:
        for span in node.spans:
            span.node_id = node.id
    return merged


def _trees(nodes: list[GraphNode], wires: dict, tolerance: int,
           repairs: list[Repair], diagnostics: list[Diagnostic]) -> None:
    right_tips: dict[int, list[int]] = defaultdict(list)
    for (y, x), ch in wires.items():
        if ch in ">→":
            right_tips[y + 1].append(x + 1)
    for node in nodes:
        for span in node.spans:
            span.cleaned_column = span.column
            span.cleaned_branch_column = span.branch_column
        if node.kind != "tree":
            continue
        anchors = Counter(s.branch_column for s in node.spans if s.branch_column is not None)
        # Cluster only within the tolerance of the first member: no transitive
        # collapse of a staircase of real indentation levels.
        clusters: list[list[int]] = []
        for anchor in sorted(anchors):
            explicit_depth = clusters and any(s.branch_column == anchor and
                any(g in clusters[-1] for g in s.guide_columns) for s in node.spans)
            if clusters and anchor - clusters[-1][0] <= tolerance and not explicit_depth:
                clusters[-1].append(anchor)
            else:
                clusters.append([anchor])
        canonical = {a: max(group, key=lambda x: (anchors[x], -x))
                     for group in clusters for a in group}
        shift = 0
        for s in node.spans:
            if s.branch_column is not None:
                # Leave a space after an incoming arrow before the tree marker.
                tips = [x for x in right_tips[s.line]
                        if 0 < s.branch_column - x <= 3]
                if tips:
                    shift = max(shift, max(tips) + 2 - canonical[s.branch_column])
        rows: dict[int, str] = {}
        for s in node.spans:
            if s.branch_column is not None:
                new = canonical[s.branch_column] + shift
                delta = new - s.branch_column
                s.cleaned_branch_column = new
                s.cleaned_column = s.column + delta
                if delta:
                    repairs.append(Repair(s.line, s.branch_column, new,
                                          s.marker + " " + s.text, "tree_alignment"))
                rows[s.line] = " " * (new - 1) + s.marker + " " + s.text
            else:
                base = min(canonical.values()) + shift
                if 0 < base - s.column <= 4:
                    s.cleaned_column = base
                    repairs.append(Repair(s.line, s.column, base, s.text, "tree_alignment"))
                rows[s.line] = " " * (s.cleaned_column - 1) + s.text
        first, last = min(rows), max(rows)
        local = "\n".join(rows.get(y, "") for y in range(first, last + 1))
        node.tree = parse_tree(local, mode="tree", continuation="nodes", label_mode="literal")
        by_line = {s.line: s for s in node.spans}
        for item in node.tree.nodes:
            item.line += first - 1
            item.end_line += first - 1
            by_line[item.line].tree_node_id = item.id
        for record in node.tree.lines:
            record.line += first - 1
        for diagnostic in node.tree.diagnostics:
            diagnostic.line += first - 1
            diagnostics.append(diagnostic)


def _vertical_links(wires: dict, tolerance: int) -> list[tuple[tuple, tuple]]:
    rows: dict[int, list[int]] = defaultdict(list)
    for (y, x), ch in wires.items():
        if ch in _VERT:
            rows[y].append(x)
    links = []
    for y, xs in rows.items():
        above = {x for x in xs if wires[y, x] not in "v↓"}
        below = {x for x in rows.get(y + 1, []) if wires[y + 1, x] not in "^↑"}
        if not tolerance:
            links.extend(((y, x), (y + 1, x)) for x in sorted(above & below))
            continue
        # Match bundles in left-to-right order. Independent nearest-neighbor
        # choices are tied when parallel wires two columns apart all drift one
        # column together. The unique order-preserving bundle match resolves it.
        groups: list[list[int]] = []
        for x in sorted(above | below):
            if not groups or x - groups[-1][-1] > tolerance:
                groups.append([])
            groups[-1].append(x)
        for group in groups:
            aa, bb = sorted(above.intersection(group)), sorted(below.intersection(group))
            links.extend(((y, x), (y + 1, k)) for x, k in _ordered_pairs(aa, bb, tolerance))
    return links


def _ordered_pairs(above: list[int], below: list[int], tolerance: int) -> list[tuple[int, int]]:
    """Keep only unambiguous pairs in an optimal monotone row matching.

    Maximize continued tracks, then minimize total drift. Forward/backward scores
    expose all equally optimal alternatives rather than selecting an arbitrary tie.
    """
    m, n = len(above), len(below)
    forward = [[(0, 0) for _ in range(n + 1)] for _ in range(m + 1)]
    backward = [[(0, 0) for _ in range(n + 1)] for _ in range(m + 1)]
    for i in range(m):
        for j in range(n):
            best = max(forward[i][j + 1], forward[i + 1][j])
            distance = abs(above[i] - below[j])
            if distance <= tolerance:
                count, drift = forward[i][j]
                best = max(best, (count + 1, drift - distance))
            forward[i + 1][j + 1] = best
    for i in range(m - 1, -1, -1):
        for j in range(n - 1, -1, -1):
            best = max(backward[i + 1][j], backward[i][j + 1])
            distance = abs(above[i] - below[j])
            if distance <= tolerance:
                count, drift = backward[i + 1][j + 1]
                best = max(best, (count + 1, drift - distance))
            backward[i][j] = best
    alternatives: list[tuple[int, int]] = []
    for i, x in enumerate(above):
        for j, k in enumerate(below):
            distance = abs(x - k)
            before, after = forward[i][j], backward[i + 1][j + 1]
            if (distance <= tolerance and
                    (before[0] + 1 + after[0], before[1] - distance + after[1]) == forward[m][n]):
                alternatives.append((x, k))
    outgoing = Counter(x for x, _ in alternatives)
    incoming = Counter(k for _, k in alternatives)
    return [(x, k) for x, k in alternatives if outgoing[x] == incoming[k] == 1]


def _straighten(lines: list[str], spans: list[Span], wires: dict, tolerance: int,
                repairs: list[Repair], diagnostics: list[Diagnostic]) -> tuple[dict, dict]:
    links = _vertical_links(wires, tolerance)
    neighbors: dict[tuple, set] = defaultdict(set)
    for a, b in links:
        neighbors[a].add(b)
        neighbors[b].add(a)
    moves: dict[tuple, tuple] = {}
    seen: set[tuple] = set()
    occupied = {(s.line - 1, x) for s in spans
                for x in range((s.cleaned_branch_column or s.cleaned_column) - 1,
                               s.cleaned_column - 1 + len(s.text))}
    for start in neighbors:
        if start in seen:
            continue
        stack, group = [start], []
        while stack:
            pos = stack.pop()
            if pos in seen:
                continue
            seen.add(pos)
            group.append(pos)
            stack.extend(neighbors[pos] - seen)
        target = max(x for _, x in group)
        group_set = set(group)
        # Move a whole run together, including corners, but never across text or
        # a neighboring wire. Ambiguous repairs remain visible in the original.
        blocked = any((y, k) in occupied or ((y, k) in wires and (y, k) not in group_set
                      and not ((wires[y, x] in "+┐┘`\\" or _crossing(wires, (y, x)))
                               and wires[y, k] in "-─━═"))
                      for y, x in group for k in range(x + 1, target + 1))
        if blocked:
            if len({x for _, x in group}) > 1:
                diagnostics.append(Diagnostic(start[0] + 1, "blocked_wire_repair",
                    "Drifting wire could not be straightened without crossing text or another wire."))
            continue
        for y, x in group:
            if x != target:
                moves[y, x] = (y, target)
                repairs.append(Repair(y + 1, x + 1, target + 1, wires[y, x], "wire_alignment"))
    cleaned = {pos: ch for pos, ch in wires.items() if pos not in moves}
    for pos, new in moves.items():
        cleaned[new] = wires[pos]
    for (y, x), (_, new) in moves.items():
        if wires[y, x] in "+┐┘`\\":
            for k in range(x, new):
                cleaned[y, k] = "-"
        elif _crossing(wires, (y, x)):
            cleaned[y, x] = "-"
    return cleaned, moves


def _crossing(wires: dict, pos: tuple[int, int]) -> bool:
    y, x = pos
    return (wires.get(pos) in ("|", "│")
            and wires.get((y, x - 1)) in ("-", "─", "━", "═")
            and wires.get((y, x + 1)) in ("-", "─", "━", "═"))


def _components(wires: dict) -> list[set[tuple]]:
    adjacent: dict[tuple, set] = defaultdict(set)
    for a, b in _vertical_links(wires, 0):
        adjacent[a].add(b)
        adjacent[b].add(a)
    for (y, x), ch in wires.items():
        b = (y, x + 1)
        if b in wires and ch not in "|│v^↓↑>→" and wires[b] not in "|│v^↓↑<←":
            adjacent[y, x].add(b)
            adjacent[b].add((y, x))
        if _crossing(wires, b):
            # '-' passes behind '|'; only '+' joins the two channels. Keep the
            # crossing cell in the vertical component and bridge it horizontally.
            across = (y, x + 2)
            adjacent[y, x].add(across)
            adjacent[across].add((y, x))
    seen: set[tuple] = set()
    result = []
    for pos in wires:
        if pos in seen:
            continue
        component, stack = set(), [pos]
        while stack:
            item = stack.pop()
            if item in seen:
                continue
            seen.add(item)
            component.add(item)
            stack.extend(adjacent[item] - seen)
        result.append(component)
    return result


def _endpoint(s: Span, *, whole_tree: bool = False) -> Endpoint:
    return Endpoint(s.node_id, None if whole_tree or s.tree_node_id == 0 else s.tree_node_id)


def _target(pos: tuple, ch: str, spans: list[Span], tolerance: int) -> list[Endpoint]:
    y, x = pos
    found = []
    for s in spans:
        start = (s.cleaned_branch_column or s.cleaned_column) - 1
        end = s.cleaned_column - 1 + len(s.text)
        if ch in ">→" and s.line == y + 1 and 0 < start - x <= tolerance + 2:
            # A head pointing at a tree's guide/branch targets the tree region;
            # a head pointing at label text targets the particular tree item.
            found.append(_endpoint(s, whole_tree=s.branch_column is not None))
        elif ch in "<←" and s.line == y + 1 and 0 <= x - end <= tolerance + 1:
            found.append(_endpoint(s))
        elif ch in "v↓^↑" and s.line == y + (2 if ch in "v↓" else 0):
            if start - tolerance <= x < end + tolerance:
                found.append(_endpoint(s))
    return list(dict.fromkeys(found))


def _trace(wires: dict, spans: list[Span], tolerance: int,
           diagnostics: list[Diagnostic]) -> list[Reference]:
    references = []
    row_spans: dict[int, list[Span]] = defaultdict(list)
    for span in spans:
        row_spans[span.line].append(span)
    for component in _components(wires):
        arrows = [p for p in sorted(component) if wires[p] in _ARROWS]
        has_route = any(wires[p] in "-─━═" for p in component)
        if not arrows and not has_route:
            continue  # Unused tree guides.
        sources: set[Endpoint] = set()
        for y, x in component:
            ch = wires[y, x]
            if ch in "|│v↓" and (y - 1, x) not in component:
                above = [s for s in row_spans[y]
                         if s.cleaned_column - 1 <= x < s.cleaned_column - 1 + len(s.text)]
                if len(above) == 1:
                    sources.add(_endpoint(above[0]))
            if ch in "|│^↑" and (y + 1, x) not in component:
                below = [s for s in row_spans[y + 2]
                         if s.cleaned_column - 1 <= x < s.cleaned_column - 1 + len(s.text)]
                if len(below) == 1:
                    sources.add(_endpoint(below[0]))
            if ch in _ARROWS:
                continue
            for s in row_spans[y + 1]:
                end = s.cleaned_column - 1 + len(s.text)
                if ch in "-─━═+┐┘`\\":
                    if (y, x - 1) not in component and 0 <= x - end <= 2:
                        sources.add(_endpoint(s))
                    if (y, x + 1) not in component and 0 < s.cleaned_column - 1 - x <= 2:
                        sources.add(_endpoint(s))
            if ch in "`\\" and (y, x - 1) not in component:
                above = [s for s in row_spans[y] if s.branch_column is not None
                         and s.cleaned_branch_column - 1 < x
                         and s.cleaned_column - 1 <= x]
                if above:
                    sources.add(_endpoint(max(above, key=lambda s: s.cleaned_column)))
        if not arrows:
            diagnostics.append(Diagnostic(min(y for y, _ in component) + 1,
                "unheaded_reference", "Reference wire has no arrowhead; no directed edge was inferred."))
            continue
        if len(sources) > 1:
            diagnostics.append(Diagnostic(min(y for y, _ in component) + 1,
                "shared_reference_bus", "Joined wire has multiple sources; each source reaches its arrow endpoints.", "info"))
        for pos in arrows:
            y = pos[0]
            target_rows = row_spans[y] + row_spans[y + 1] + row_spans[y + 2]
            targets = _target(pos, wires[pos], target_rows, tolerance)
            if len(targets) != 1 or not sources:
                diagnostics.append(Diagnostic(pos[0] + 1, "unresolved_reference",
                    f"Arrow at column {pos[1] + 1} has {len(sources)} source(s) and {len(targets)} target candidate(s)."))
                continue
            for source in sorted(sources, key=lambda e: (e.node_id, e.tree_node_id or -1)):
                # A crossing belongs geometrically to both routes, although the
                # two channels are kept separate while determining connectivity.
                cells = component | {(y, x + 1) for y, x in component
                                     if _crossing(wires, (y, x + 1)) and (y, x + 2) in component}
                references.append(Reference(source, targets[0], pos[0] + 1, pos[1] + 1,
                    [(y + 1, x + 1) for y, x in sorted(cells)]))
    return references


def _render(lines: list[str], spans: list[Span], old_wires: dict, wires: dict,
            diagnostics: list[Diagnostic]) -> str:
    canvas = [list(row) for row in lines]
    def erase(y: int, start: int, end: int) -> None:
        for x in range(start, min(end, len(canvas[y]))):
            canvas[y][x] = " "
    for s in spans:
        erase(s.line - 1, (s.branch_column or s.column) - 1, s.column - 1 + len(s.text))
    for y, x in old_wires:
        erase(y, x, x + 1)
    placements = [(y, x, ch) for (y, x), ch in wires.items()]
    for s in spans:
        if s.branch_column is not None:
            placements.extend((s.line - 1, s.cleaned_branch_column - 1 + k, ch)
                              for k, ch in enumerate(s.marker + " "))
        placements.extend((s.line - 1, s.cleaned_column - 1 + k, ch)
                          for k, ch in enumerate(s.text))
    for y, x, ch in placements:
        canvas[y].extend(" " for _ in range(x + 1 - len(canvas[y])))
        if canvas[y][x] not in (" ", ch) and ch != " ":
            diagnostics.append(Diagnostic(y + 1, "cleanup_collision",
                f"Cleanup would overwrite content at column {x + 1}; returning the original drawing.", "error"))
            return "\n".join(lines)
        if ch != " ":
            canvas[y][x] = ch
    return "\n".join("".join(row).rstrip() for row in canvas)


def parse_graph(text: str, *, tree_tolerance: int = 1, wire_tolerance: int = 2,
                tab_size: int = 4, strict: bool = False,
                max_chars: int = 1_000_000, max_spans: int = 10_000) -> GraphResult:
    """Parse the regular ASCII graph dialect; unresolved routes are diagnostics.

    Cleanup preserves layout and labels, aligning bounded drift only. Tree node
    positions refer to cleaned text; Span positions retain the original positions.
    Arrow endpoints on a neighboring tree's branch address that whole tree.
    """
    if not isinstance(text, str):
        raise TypeError("text must be str")
    if min(tree_tolerance, wire_tolerance) < 0 or min(tab_size, max_chars, max_spans) < 1:
        raise ValueError("tolerances must be nonnegative and limits/tab_size positive")
    if len(text) > max_chars:
        raise ValueError(f"input exceeds max_chars={max_chars}")
    lines = text.expandtabs(tab_size).splitlines()
    spans, original_wires, _ = _scan(lines, wire_tolerance)
    if len(spans) > max_spans:
        raise ValueError(f"input exceeds max_spans={max_spans}")
    diagnostics: list[Diagnostic] = []
    repairs: list[Repair] = []
    nodes = _partition(spans, tree_tolerance, original_wires)
    if not nodes:
        diagnostics.append(Diagnostic(1, "empty_graph", "No graph nodes found.", "error"))
    _trees(nodes, original_wires, tree_tolerance, repairs, diagnostics)
    wires, _ = _straighten(lines, spans, original_wires, wire_tolerance, repairs, diagnostics)
    references = _trace(wires, spans, wire_tolerance, diagnostics)
    cleaned = _render(lines, spans, original_wires, wires, diagnostics)
    result = GraphResult(nodes, references, diagnostics, repairs, text, cleaned)
    if strict and any(d.severity != "info" for d in diagnostics):
        raise GraphParseError(result)
    return result


def _render_subtree(tree: ParseResult, root_id: int) -> str:
    rows = []
    pending = [(root_id, "", "")]
    while pending:
        node_id, prefix, connector = pending.pop()
        node = tree.nodes[node_id]
        rows.append(prefix + connector + node.label.replace("\n", r"\n"))
        child_prefix = prefix
        if connector:
            child_prefix += "    " if connector == "\\-- " else "|   "
        for child_id in reversed(node.children):
            child_connector = "\\-- " if child_id == node.children[-1] else "+-- "
            pending.append((child_id, child_prefix, child_connector))
    return "\n".join(rows)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", nargs="?", default="-")
    parser.add_argument("--format", choices=("json", "ascii"), default="json")
    parser.add_argument("--nodes", action="store_true",
                        help="print every node in source order with its subtree (overrides --format)")
    parser.add_argument("--cleaned-output", type=Path)
    parser.add_argument("--strict", action="store_true")
    args = parser.parse_args(argv)
    source = sys.stdin.read() if args.file == "-" else Path(args.file).read_text(encoding="utf-8")
    result = parse_graph(source)
    if args.cleaned_output:
        args.cleaned_output.write_text(result.cleaned_ascii + "\n", encoding="utf-8")
    if args.nodes:
        labels = []
        for node in result.nodes:
            if node.tree:
                labels.extend((item.line, item.column, _render_subtree(node.tree, item.id))
                              for item in node.tree.nodes)
            else:
                labels.append((node.spans[0].line, node.spans[0].column,
                               node.text.replace("\n", r"\n")))
        for index, (_, _, label) in enumerate(sorted(labels), 1):
            prefix = f"{index}. "
            print(prefix + label.replace("\n", "\n" + " " * len(prefix)))
    else:
        print(result.cleaned_ascii if args.format == "ascii" else json.dumps(result.to_dict(), indent=2))
    if args.nodes or args.format == "ascii":
        for diagnostic in result.diagnostics:
            print(f"line {diagnostic.line}: {diagnostic.code}: {diagnostic.message}", file=sys.stderr)
    return int(any(d.severity == "error" or (args.strict and d.severity != "info")
                   for d in result.diagnostics))


if __name__ == "__main__":
    raise SystemExit(main())
