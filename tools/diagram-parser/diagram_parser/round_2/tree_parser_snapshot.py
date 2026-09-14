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


def _rows(text: str, tab_size: int, mode: str, result: ParseResult) -> list[_Row]:
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
                fences[active[2]] = (i, active[3] in {"", "ascii", "text", "txt", "tree", "plaintext", "console"})
                active = None
    if active:
        fences[active[2]] = (len(normalized), active[3] in {"", "ascii", "text", "txt", "tree", "plaintext", "console"})
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


def parse_tree(text: str, *, strict: bool = False, mode: str = "auto",
               tab_size: int = 4, continuation: str = "auto",
               max_nodes: int = 100_000, max_chars: int = 10_000_000) -> ParseResult:
    """Parse an ordered forest.

    mode='auto' extracts supported Markdown fences and excludes surrounding prose;
    mode='tree' treats the input as tree text (useful for prose-like node labels).
    continuation='auto' joins aligned wraps, 'nodes' keeps plain lines as nodes,
    and 'join' joins all indented plain lines to their predecessor.
    strict=True raises TreeParseError with the partial result on any diagnostic.
    """
    if not isinstance(text, str):
        raise TypeError("text must be str")
    if mode not in {"auto", "tree"} or continuation not in {"auto", "nodes", "join"}:
        raise ValueError("invalid mode or continuation policy")
    if tab_size < 1 or max_nodes < 1 or max_chars < 1:
        raise ValueError("tab_size and limits must be positive")
    if len(text) > max_chars:
        raise ValueError(f"input exceeds max_chars={max_chars}")
    result = ParseResult()
    rows = _rows(text, tab_size, mode, result)
    # Lookahead skips blank/guide rows, but never crosses a code-fence boundary.
    following: dict[int, _Row] = {}
    next_row: _Row | None = None
    blocks_with_branches = {r.block for r in rows if r.kind in _MARKED}
    for row in reversed(rows):
        if next_row is not None and next_row.block == row.block:
            following[row.line] = next_row
        if row.kind in _MARKED | {"plain", "prose"}:
            next_row = row
    stack: list[tuple[int, int]] = []  # (geometric branch anchor, node ID)
    previous: _Row | None = None
    previous_block = -1
    prose_section = False
    for row in rows:
        if row.block != previous_block:
            stack.clear()
            previous = None
            prose_section = False
            previous_block = row.block
        if row.kind in {"blank", "guide", "border", "fence", "outside"}:
            result.lines.append(LineRecord(row.line, row.kind))
            continue
        next_row = following.get(row.line)
        branch_block = row.block in blocks_with_branches
        follows_parent = next_row is not None and next_row.kind in _MARKED and next_row.anchor >= row.anchor
        root_column = result.nodes[stack[0][1]].column - 1 if stack else 0
        if row.kind == "prose" and mode == "auto" and not follows_parent:
            result.lines.append(LineRecord(row.line, "prose"))
            prose_section = row.anchor <= root_column
            continue
        if row.kind not in _MARKED:
            prev_node = result.nodes[stack[-1][1]] if stack else None
            # Plain roots often share column zero with their first child's connector.
            is_root = follows_parent and (not stack or row.anchor <= root_column)
            if mode == "auto" and branch_block and not follows_parent and (prose_section or row.anchor <= root_column):
                result.lines.append(LineRecord(row.line, "prose"))
                continue
            if branch_block and prev_node and not is_root and not follows_parent and continuation != "nodes":
                aligned = row.column == prev_node.column - 1
                hanging = row.column >= prev_node.column - 1 and prev_node.label.endswith(("/", ",", "\\"))
                if aligned or hanging or (continuation == "join" and row.anchor > stack[-1][0]):
                    prev_node.label += " " + row.label
                    prev_node.raw_lines.append(row.raw)
                    prev_node.end_line = row.line
                    result.lines.append(LineRecord(row.line, "continuation", prev_node.id))
                    result.diagnostics.append(Diagnostic(row.line, "joined_continuation", "Joined an unmarked line to the preceding label.", "info"))
                    continue
            if is_root:
                stack.clear()
                row.anchor = min(row.anchor, next_row.anchor) - 1
            elif follows_parent and next_row.anchor == row.anchor:
                row.anchor -= 1
            elif branch_block and prev_node:
                result.diagnostics.append(Diagnostic(row.line, "unmarked_node", "Treated an unmarked indented line as a node; it may be wrapped text."))
        elif (row.kind == "bullet" and previous and previous.kind == "branch"
              and row.line > previous.line + 1 and row.anchor <= root_column):
            # A separate Markdown list after a tree is a forest, not children of
            # the last plain root whose first connector shared its column.
            stack.clear()
        prose_section = False
        if not row.label:
            result.lines.append(LineRecord(row.line, "unparsed"))
            result.diagnostics.append(Diagnostic(row.line, "empty_label", "No label found."))
            continue
        # Parent is the nearest preceding shallower anchor. No fixed indentation
        # width: 2/3/4/8 spaces and inconsistent connector lengths are all common.
        old_anchor = stack[-1][0] if stack else None
        popped: list[int] = []
        while stack and stack[-1][0] >= row.anchor:
            popped.append(stack.pop()[0])
        if popped and row.anchor not in popped and stack and old_anchor is not None:
            result.diagnostics.append(Diagnostic(row.line, "irregular_dedent", "Dedent did not match an existing level; attached to the nearest shallower node."))
        parent_id = stack[-1][1] if stack else None
        depth = result.nodes[parent_id].depth + 1 if parent_id is not None else 0
        if len(result.nodes) >= max_nodes:
            raise ValueError(f"input exceeds max_nodes={max_nodes}")
        node = Node(len(result.nodes), row.label, parent_id, depth, row.line,
                    row.column + 1, row.line, row.anchor + 1, raw_lines=[row.raw])
        result.nodes.append(node)
        if parent_id is None:
            result.roots.append(node.id)
        else:
            result.nodes[parent_id].children.append(node.id)
        stack.append((row.anchor, node.id))
        result.lines.append(LineRecord(row.line, "node", node.id))
        previous = row
    if not result.nodes:
        result.diagnostics.append(Diagnostic(1, "empty_tree", "No tree nodes found.", "error"))
    for record, row in zip(result.lines, rows):
        record.raw = row.raw
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
    parser.add_argument("--tab-size", type=int, default=4)
    args = parser.parse_args(argv)
    outputs = []
    failed = False
    for filename in args.files or ["-"]:
        try:
            source = sys.stdin.read() if filename == "-" else Path(filename).read_text(encoding="utf-8")
            result = parse_tree(source, mode=args.mode, continuation=args.continuation, tab_size=args.tab_size)
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
