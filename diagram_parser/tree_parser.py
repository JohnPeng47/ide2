#!/usr/bin/env python3
"""Parse imperfect LLM tree text into an ordered forest (Python 3.10+, stdlib).

`parse_tree(text)` returns flat nodes, root IDs, diagnostics, and a classification
for EVERY source line. IDs are array indices; labels are never used as identities.
Columns are one-based after ANSI removal, whitespace normalization and tab expansion.
The original source lines remain available on each node. See README.md for policy.
"""

from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass, field
import json
from pathlib import Path
import re
import sys
from typing import Iterator


@dataclass
class Diagnostic:
    line: int
    code: str
    message: str
    severity: str = "warning"


@dataclass
class Decoration:
    """Drawing syntax removed from a semantic label; columns are normalized."""

    line: int
    column: int
    text: str
    kind: str = "reference_wire"


@dataclass
class Node:
    id: int
    label: str
    parent_id: int | None
    depth: int
    line: int
    column: int
    end_line: int
    branch_column: int
    children: list[int] = field(default_factory=list)
    raw_lines: list[str] = field(default_factory=list)
    decorations: list[Decoration] = field(default_factory=list)


@dataclass
class LineRecord:
    line: int
    kind: str
    node_id: int | None = None
    raw: str = ""


@dataclass
class ParseResult:
    nodes: list[Node] = field(default_factory=list)
    roots: list[int] = field(default_factory=list)
    diagnostics: list[Diagnostic] = field(default_factory=list)
    lines: list[LineRecord] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)

    def walk(self) -> Iterator[Node]:
        """Preorder, without recursion (also the order in `nodes`)."""
        return iter(self.nodes)

    def render(self, indent: int = 4) -> str:
        """Canonical ASCII, with explicit root connectors to preserve leaf roots."""
        if indent < 4:
            raise ValueError("render indent must be at least 4")
        rows: list[str] = []
        guides: list[str] = []
        for node in self.nodes:
            siblings = self.roots if node.parent_id is None else self.nodes[node.parent_id].children
            last = siblings[-1] == node.id
            guides = guides[:node.depth]
            rows.append("".join(guides) + ("\\-- " if last else "+-- ") + node.label)
            guides.append(" " * indent if last else "|" + " " * (indent - 1))
        return "\n".join(rows)


class TreeParseError(ValueError):
    def __init__(self, result: ParseResult):
        self.result = result
        super().__init__("; ".join(f"line {d.line}: {d.message}" for d in result.diagnostics))


_ANSI = re.compile(r"\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~])")
_INVISIBLE = str.maketrans({"\ufeff": "", "\u200b": "", "\u200c": "", "\u200d": "",
                            "\u00a0": " ", "\u202f": " ", "\u2007": " "})
_VERTICAL = "|│┃┆┊║¦╎╏:"
_DASH = "-─━═╌╍┄┅┈┉–—_"
_JOINT = "+\\`'├└┝┞┟┠┡┢┣┗┖╠╚╟╙╰╘╞┌╭|"
_BRANCH = re.compile(
    rf"^(?P<prefix>[ {re.escape(_VERTICAL)}]*?)"
    rf"(?P<marker>[{re.escape(_JOINT)}][{_DASH}]+[>›]?|"
    rf"[{_DASH}]{{1,}}[>›]|[{_DASH}]{{2,}}|[→↳↪➜➝➞]|[├└┣┗╠╚╰](?= ))"
    r"[ ]*(?P<label>\S.*?)\s*$"
)
_BULLET = re.compile(rf"^(?P<prefix>[ {re.escape(_VERTICAL)}]*?)(?P<marker>[-+*•●◦▪▸▹]|\d+[.)])[ ]+(?P<label>\S.*?)\s*$")
_GUIDE = re.compile(rf"^[ {re.escape(_VERTICAL)}]*$")
_BORDER = re.compile(r"^[ +\-_=─━═┌┐└┘┏┓┗┛╔╗╚╝╭╮╰╯┬┴┼╤╧╪]+$")
_FENCE = re.compile(r"^\s*(?P<marker>`{3,}|~{3,})(?P<info>[^`]*)$")
_HEADING = re.compile(r"^\s*#{1,6}\s+")
_PROSE = re.compile(r"^(?:here(?:'s| is| are)\b|below\b|the (?:following|tree|diagram)\b|"
                    r"(?:notes?|legend|notation|scope|explanation|key|relationships)(?:\s*:|$))", re.I)
_MARKED = {"branch", "bullet"}
_TRIVIA = {"blank", "guide", "border", "fence", "outside", "excluded_prose"}
_TREE_FENCES = {"", "ascii", "text", "txt", "tree", "plaintext", "console"}
_WIRE_SUFFIX = re.compile(
    r" +(?P<wire>[<←]?[-─━═]{2,}[+┐┘╮╯](?:[-─━═]+[+┐┘╮╯])*|[|│┃║])$"
)


@dataclass
class _Row:
    line: int
    raw: str
    text: str
    kind: str
    anchor: int = 0
    column: int = 0
    label: str = ""
    block: int = 0
    decoration: Decoration | None = None


def _normalize(text: str, tab_size: int) -> str:
    return _ANSI.sub("", text).translate(_INVISIBLE).expandtabs(tab_size)


def _lex(line: int, raw: str, text: str, block: int) -> _Row:
    row = _Row(line, raw, text, "plain", block=block)
    if not text.strip():
        row.kind = "blank"
    elif _GUIDE.fullmatch(text):
        row.kind = "guide"
    elif len(text.strip()) >= 3 and _BORDER.fullmatch(text):
        row.kind = "border"
    else:
        match = _BRANCH.match(text)
        bullet = _BULLET.match(text) if match is None else None
        match = match or bullet
        if match:
            row.kind = "bullet" if bullet else "branch"
            row.anchor = match.start("marker")
            row.column = match.start("label")
            row.label = match["label"]
        else:
            # A vertical guide may precede a wrapped label without a connector.
            prefix = re.match(rf"^[ {re.escape(_VERTICAL)}]*", text)[0]
            row.anchor = row.column = len(prefix)
            row.label = text[len(prefix):].rstrip()
            if _HEADING.match(text) or _PROSE.match(row.label):
                row.kind = "prose"
    return row


def _prepare_rows(text: str, tab_size: int, mode: str, result: ParseResult) -> list[_Row]:
    raw_lines = text.splitlines()
    normalized = [_normalize(line, tab_size) for line in raw_lines]
    # Strip Markdown quote wrappers only when present consistently on nonblank lines.
    quoted = [line for line in normalized if line.strip()]
    if quoted and all(re.match(r"^\s*>[ ]?", line) for line in quoted):
        normalized = [re.sub(r"^\s*>[ ]?", "", line) for line in normalized]
    fences: dict[int, tuple[int, bool]] = {}
    active: tuple[str, int, int, str] | None = None
    for i, line in enumerate(normalized):
        match = _FENCE.match(line)
        if match:
            marker, info = match["marker"], match["info"].strip().lower()
            if active is None:
                active = (marker[0], len(marker), i, info)
            elif marker[0] == active[0] and len(marker) >= active[1] and not info:
                fences[active[2]] = (i, active[3] in _TREE_FENCES)
                active = None
    if active:
        fences[active[2]] = (len(normalized), active[3] in _TREE_FENCES)
        result.diagnostics.append(Diagnostic(active[2] + 1, "unclosed_fence", "Code fence is not closed."))
    selected: set[int] = set()
    for start, (end, allowed) in fences.items():
        if allowed and any(_lex(i + 1, raw_lines[i], normalized[i], 0).kind in _MARKED | {"plain"}
                           for i in range(start + 1, end)):
            selected.add(start)
    has_selected = bool(selected) and mode == "auto"
    rows: list[_Row] = []
    current_end, current_selected = -1, False
    block = 0
    # Recognize outer frames only when a cornered horizontal edge exists. A pipe
    # at the end of an ordinary label is not itself evidence of an outer frame.
    framed = any(re.match(r"^\s*[+┌┏╔╭][-─━═]{3,}[+┐┓╗╮]\s*$", line) for line in normalized)
    for i, (raw, line) in enumerate(zip(raw_lines, normalized)):
        if i in fences:
            current_end, _ = fences[i]
            current_selected = i in selected
            block += 1
            rows.append(_Row(i + 1, raw, line, "fence", block=block))
            continue
        if i == current_end:
            rows.append(_Row(i + 1, raw, line, "fence", block=block))
            current_selected = False
            block += 1
            continue
        inside = i < current_end
        if (inside and not current_selected) or (has_selected and not inside):
            rows.append(_Row(i + 1, raw, line, "outside", block=block))
            continue
        if framed:
            frame = re.match(r"^( *)([|│┃║]) ?(.*?) ?[|│┃║]\s*$", line)
            if frame:
                # Preserve label column offsets relative to the normalized input.
                line = " " * frame.start(3) + frame[3]
        rows.append(_lex(i + 1, raw, line, block))
    return rows


def _lookahead(rows: list[_Row]) -> dict[int, _Row]:
    """Next semantic row, without crossing a Markdown block boundary."""
    following: dict[int, _Row] = {}
    next_row: _Row | None = None
    for row in reversed(rows):
        if next_row is not None and next_row.block == row.block:
            following[row.line] = next_row
        if row.kind not in _TRIVIA:
            next_row = row
    return following


def _exclude_detached_lists(rows: list[_Row]) -> None:
    """In mixed documents, detached ordinary lists after trees are prose.

    Pure bullet trees and indented/guided lists within a tree remain nodes.
    Explicit +--/\\-- appendices remain trees regardless of their heading.
    """
    top: dict[int, int] = {}
    for row in rows:
        if row.kind == "branch":
            top[row.block] = min(top.get(row.block, row.anchor), row.anchor)
    following = _lookahead(rows)
    block = -1
    seen_branch = separated = excluding = False
    heading: _Row | None = None
    for row in rows:
        if row.block != block:
            block = row.block
            seen_branch = separated = excluding = False
            heading = None
        if row.kind == "branch":
            seen_branch = True
            separated = excluding = False
            heading = None
        elif row.kind == "blank":
            separated = seen_branch
        elif row.kind in {"plain", "prose"}:
            heading = row
            next_row = following.get(row.line)
            if next_row and next_row.kind == "branch":
                excluding = False
            elif excluding:
                row.kind = "excluded_prose"
        elif row.kind == "bullet":
            if seen_branch and separated and row.anchor <= top[row.block]:
                excluding = True
                if heading and following.get(heading.line) is row:
                    heading.kind = "excluded_prose"
            if excluding:
                row.kind = "excluded_prose"


def _clean_routed_wires(rows: list[_Row]) -> None:
    """Remove suffix graphics only inside a paired, multirow reference route.

    A lone pipe/dash suffix is kept. Named inline arrows are also kept. Opposite
    outgoing/incoming endpoints delimit a route; multiple outgoing joins support
    shared buses. Small alignment drift is allowed because LLM wires often wobble.
    The glyphs and original source survive in decoration metadata and raw_lines.
    """
    pending: list[tuple[_Row, re.Match]] = []
    endpoints: list[int] = []
    first_incoming = False
    block = -1
    for row in rows:
        if row.block != block or row.kind not in _MARKED | {"guide"}:
            pending.clear()
            endpoints.clear()
            block = row.block
        match = _WIRE_SUFFIX.search(row.label) if row.kind in _MARKED else None
        if match is None:
            continue
        wire = match["wire"]
        if wire in "|│┃║":
            if pending:
                pending.append((row, match))
            continue
        incoming = wire.startswith(("<", "←"))
        if not pending:
            first_incoming = incoming
        pending.append((row, match))
        endpoints.append(row.column + match.end() - 1)
        if incoming == first_incoming:
            continue
        left, right = min(endpoints) - 2, max(endpoints) + 2
        for candidate, suffix in pending:
            # Do not eat an unrelated literal pipe elsewhere on an intervening row.
            if suffix["wire"] in "|│┃║" and not left <= candidate.column + suffix.end() - 1 <= right:
                continue
            candidate.decoration = Decoration(
                candidate.line, candidate.column + suffix.start() + 1, suffix[0]
            )
            candidate.label = candidate.label[:suffix.start()].rstrip()
        pending.clear()
        endpoints.clear()


class _ForestBuilder:
    """Geometry and recovery state for a single parse; no recursive traversal."""

    def __init__(self, result: ParseResult, rows: list[_Row], mode: str,
                 continuation: str, max_nodes: int):
        self.result = result
        self.mode = mode
        self.continuation = continuation
        self.max_nodes = max_nodes
        self.following = _lookahead(rows)
        self.marked_blocks = {row.block for row in rows if row.kind in _MARKED}
        self.stack: list[tuple[int, int]] = []
        self.previous: _Row | None = None
        self.block = -1
        self.prose_section = False

    def record(self, row: _Row, kind: str, node_id: int | None = None) -> None:
        self.result.lines.append(LineRecord(row.line, kind, node_id, row.raw))

    def diagnose(self, row: _Row, code: str, message: str, severity: str = "warning") -> None:
        self.result.diagnostics.append(Diagnostic(row.line, code, message, severity))

    def consume(self, row: _Row) -> None:
        if row.block != self.block:
            self.stack.clear()
            self.previous = None
            self.prose_section = False
            self.block = row.block
        if row.kind in _TRIVIA:
            self.record(row, "prose" if row.kind == "excluded_prose" else row.kind)
            return
        root_column = self.result.nodes[self.stack[0][1]].column - 1 if self.stack else 0
        if row.kind not in _MARKED:
            if self.consume_plain(row, root_column):
                return
        elif (row.kind == "bullet" and self.previous and self.previous.kind == "branch"
              and row.line > self.previous.line + 1 and row.anchor <= root_column):
            self.stack.clear()
        self.prose_section = False
        self.add_node(row)

    def consume_plain(self, row: _Row, root_column: int) -> bool:
        """Return true when the row was prose or joined text, rather than a node."""
        next_row = self.following.get(row.line)
        has_children = next_row is not None and next_row.kind in _MARKED and next_row.anchor >= row.anchor
        marked_block = row.block in self.marked_blocks
        if row.kind == "prose" and self.mode == "auto" and not has_children:
            self.record(row, "prose")
            self.prose_section = row.anchor <= root_column
            return True
        is_root = has_children and (not self.stack or row.anchor <= root_column)
        if (self.mode == "auto" and marked_block and not has_children
                and (self.prose_section or row.anchor <= root_column)):
            self.record(row, "prose")
            return True
        previous = self.result.nodes[self.stack[-1][1]] if self.stack else None
        if marked_block and previous and not is_root and not has_children and self.should_join(row, previous):
            previous.label += " " + row.label
            previous.raw_lines.append(row.raw)
            previous.end_line = row.line
            self.record(row, "continuation", previous.id)
            self.diagnose(row, "joined_continuation", "Joined an unmarked line to the preceding label.", "info")
            return True
        if is_root:
            self.stack.clear()
            row.anchor = min(row.anchor, next_row.anchor) - 1
        elif has_children and next_row.anchor == row.anchor:
            row.anchor -= 1
        elif marked_block and previous:
            self.diagnose(row, "unmarked_node", "Treated an unmarked indented line as a node; it may be wrapped text.")
        return False

    def should_join(self, row: _Row, previous: Node) -> bool:
        if self.continuation == "nodes":
            return False
        aligned = row.column == previous.column - 1
        hanging = row.column >= previous.column - 1 and previous.label.endswith(("/", ",", "\\"))
        return aligned or hanging or (self.continuation == "join" and row.anchor > self.stack[-1][0])

    def add_node(self, row: _Row) -> None:
        if not row.label:
            self.record(row, "unparsed")
            self.diagnose(row, "empty_label", "No label found.")
            return
        popped: list[int] = []
        while self.stack and self.stack[-1][0] >= row.anchor:
            popped.append(self.stack.pop()[0])
        if popped and row.anchor not in popped and self.stack:
            self.diagnose(row, "irregular_dedent", "Dedent did not match an existing level; attached to the nearest shallower node.")
        parent_id = self.stack[-1][1] if self.stack else None
        depth = self.result.nodes[parent_id].depth + 1 if parent_id is not None else 0
        if len(self.result.nodes) >= self.max_nodes:
            raise ValueError(f"input exceeds max_nodes={self.max_nodes}")
        node = Node(len(self.result.nodes), row.label, parent_id, depth, row.line,
                    row.column + 1, row.line, row.anchor + 1, raw_lines=[row.raw],
                    decorations=[row.decoration] if row.decoration else [])
        self.result.nodes.append(node)
        siblings = self.result.roots if parent_id is None else self.result.nodes[parent_id].children
        siblings.append(node.id)
        self.stack.append((row.anchor, node.id))
        self.record(row, "node", node.id)
        self.previous = row


def parse_tree(text: str, *, strict: bool = False, mode: str = "auto",
               tab_size: int = 4, continuation: str = "auto",
               label_mode: str = "semantic", list_policy: str = "auto",
               max_nodes: int = 100_000, max_chars: int = 10_000_000) -> ParseResult:
    """Parse an ordered forest, preserving every original source line.

    Auto mode extracts trees from prose; tree mode includes unmarked prose/list
    nodes. Semantic labels exclude paired routing graphics (use label_mode='literal'
    to retain them). list_policy='include' retains detached bullet appendices.
    continuation='auto' joins aligned wraps; 'nodes' keeps them separate, and 'join'
    joins any indented plain line. Strict parsing raises on any diagnostic.
    """
    if not isinstance(text, str):
        raise TypeError("text must be str")
    choices = {"mode": (mode, {"auto", "tree"}),
               "continuation": (continuation, {"auto", "nodes", "join"}),
               "label_mode": (label_mode, {"semantic", "literal"}),
               "list_policy": (list_policy, {"auto", "include"})}
    for name, (value, allowed) in choices.items():
        if value not in allowed:
            raise ValueError(f"invalid {name}: {value!r}; expected one of {sorted(allowed)}")
    if tab_size < 1 or max_nodes < 1 or max_chars < 1:
        raise ValueError("tab_size and limits must be positive")
    if len(text) > max_chars:
        raise ValueError(f"input exceeds max_chars={max_chars}")
    result = ParseResult()
    rows = _prepare_rows(text, tab_size, mode, result)
    if mode == "auto" and list_policy == "auto":
        _exclude_detached_lists(rows)
    if label_mode == "semantic":
        _clean_routed_wires(rows)
    builder = _ForestBuilder(result, rows, mode, continuation, max_nodes)
    for row in rows:
        builder.consume(row)
    if not result.nodes:
        result.diagnostics.append(Diagnostic(1, "empty_tree", "No tree nodes found.", "error"))
    if strict and result.diagnostics:
        raise TreeParseError(result)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs="*", help="UTF-8 tree files (default: stdin)")
    parser.add_argument("--strict", action="store_true", help="fail on any recovery or ambiguity")
    parser.add_argument("--format", choices=["json", "ascii"], default="json")
    parser.add_argument("--mode", choices=["auto", "tree"], default="auto")
    parser.add_argument("--continuation", choices=["auto", "nodes", "join"], default="auto")
    parser.add_argument("--label-mode", choices=["semantic", "literal"], default="semantic")
    parser.add_argument("--list-policy", choices=["auto", "include"], default="auto")
    parser.add_argument("--tab-size", type=int, default=4)
    args = parser.parse_args(argv)
    outputs = []
    failed = False
    for filename in args.files or ["-"]:
        try:
            source = sys.stdin.read() if filename == "-" else Path(filename).read_text(encoding="utf-8")
            result = parse_tree(source, mode=args.mode, continuation=args.continuation, tab_size=args.tab_size,
                                label_mode=args.label_mode, list_policy=args.list_policy)
            failed |= bool(result.diagnostics) if args.strict else any(d.severity == "error" for d in result.diagnostics)
            if args.format == "ascii":
                print(result.render())
                for diagnostic in result.diagnostics:
                    print(f"{filename}:{diagnostic.line}: {diagnostic.code}: {diagnostic.message}", file=sys.stderr)
            else:
                outputs.append({"file": filename, **result.to_dict()})
        except (OSError, UnicodeError, ValueError) as exc:
            failed = True
            print(f"{filename}: {exc}", file=sys.stderr)
    if args.format == "json":
        print(json.dumps(outputs[0] if len(outputs) == 1 else outputs, ensure_ascii=False, indent=2))
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
