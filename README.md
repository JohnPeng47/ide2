# Start the diagram server

From the project root, install dependencies once:

```sh
npm ci
```

Build and start the server:

```sh
npm run build:local
```

Open http://localhost:5191/.

The server uses this checkout as its project root and
`.diagrams-local/canvas-domain-model/` for diagram and workspace data.
The eight current canvases are included in the repository; generated workspace
records stay local.
