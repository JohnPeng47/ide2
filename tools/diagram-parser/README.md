# Diagram parser tool

The Python implementation, fixtures, and frozen evaluation bundles live together
in [`diagram_parser/`](diagram_parser/README.md). The package was relocated intact
so its internal paths and archived evidence retain their meaning.

From this directory:

```sh
python3 -m unittest discover -s diagram_parser -p 'test_*.py'
python3 diagram_parser/tree_parser.py diagram_parser/original_tree.txt
```
