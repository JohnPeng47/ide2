# Diagram parser tool

The application now has a TypeScript [spatial interpreter](../../domain/core/diagrams/interpreter/README.md)
with independent recognition, interpretation, recovery, and source mapping.
Run it from the repository root with `npm run parse:diagram -- <file> --dialect graph`.
The Python implementation and its frozen evaluation artifacts remain available
as historical tools and independently reviewed regression fixtures.

The Python implementation, fixtures, and frozen evaluation bundles live together
in [`diagram_parser/`](diagram_parser/README.md). The package was relocated intact
so its internal paths and archived evidence retain their meaning.

From this directory:

```sh
python3 -m unittest discover -s diagram_parser -p 'test_*.py'
python3 diagram_parser/tree_parser.py diagram_parser/original_tree.txt
```
