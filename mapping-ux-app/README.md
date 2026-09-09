# Mapping UX app

Standalone extraction of **Prompt, Reference, Lineage, and Portability** from
`http://127.0.0.1:5177/mapping?diagram=representation-a302e06c3b42121f3297b1a1dbffeee7`.

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5187/mapping?diagram=representation-a302e06c3b42121f3297b1a1dbffeee7.
`npm run build` checks types and creates a production build; `npm run preview` serves it.

The original Mapping components and styles were copied before edits. The app has
its own dependencies and does not contact the original server or read its files.
Only this diagram and the linked call-tree revisions, projection links, source
snapshots, and compactions needed by its Mapping interactions are included.
The explorer shows the selected diagram and any diagrams you create in this copy.
Studio and Experiments tabs retain their positions but are disabled.

Selection, projection (`N`), source compactions, pan/zoom, grouping, collapse,
movement, undo/redo, local conversation layouts, and New/Save are functional.
Prompt/edit/generation and chat use explicitly labeled deterministic demo responses;
this extraction does not contain an LLM backend. Saved revisions live in this
origin's browser localStorage under `mapping-ux-app:project:v1`. Clear that key to
restore the bundled snapshot. Chats, undo history, and viewport state are temporary.

`data/project-snapshot.json` is the scoped initial data. `data/extraction.json`
records the primary diagram and its supporting data. `data/original-file-hashes.json`
records the original files at copy time so their preservation can be checked.
