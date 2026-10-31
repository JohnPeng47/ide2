# Persisted analysis runs

`whole-repository.json.gz` is the complete, canonical schema-v1 JSON graph, stored
locally in this directory. `whole-repository.run.json` records its snapshot and run
measurements. The generated [report](../architecture-whole-repository.md) and
[source-based interpretation](../architecture-notes.md) explain its findings.

The compressed graph is hundreds of megabytes and is excluded from Git; the
implementation, schema, reproducible command, report and small run manifest are
versioned. Regenerate it from the desired checkout with `npm run analysis:run`.
A dirty source checkout has a different snapshot: preserve the input files or
content-addressed source evidence when sharing the graph with another machine.

Selected runs use `selected-scope.json.gz` and `selected-scope.run.json`. For example:

```sh
npm run analysis:run -- src/features/mapping/workspace
```

Decompress with `gzip -dc whole-repository.json.gz > whole-repository.json`.
The result is ordinary JSON. Whole-repository output can exceed V8's single-string
limit; use a streaming parser or the record-stream verifier rather than loading
it into one JavaScript string. Timing and memory are sidecar measurements, not
part of the deterministic source graph.
