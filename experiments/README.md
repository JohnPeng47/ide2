# ASCII Diagram Axis Experiments

This resumable CLI tests whether a normalized scalar produces a monotonic, distinguishable ASCII-diagram response above same-value stochastic variation. It currently runs `semantic_zoom` against TLB-10 and `topology` against TLB-40.

Every generation, blind judgment, and prompt-analysis session is pinned to `gpt-5.6-sol`. Source DiagramSets are read-only. Results, exact prompt snapshots, diagrams, judgments, deterministic aggregates, and recommendations are stored in a separate output directory.

```bash
npm --prefix scripts/new-diagram run experiment -- plan
npm --prefix scripts/new-diagram run experiment -- run \
  --source /home/john/drone-interception \
  --output /home/john/drone-interception/.datasets/diagram-axis-control-semantic-topology-v1 \
  --through 2 \
  --runtime sol \
  --concurrency 3
```

Re-running the same command resumes from existing JSON records. Use `--runtime fake` with a different output directory for a model-free smoke test.

Iteration 1 uses values `0, 0.5, 1`; iteration 2 uses `0, 0.25, 0.5, 0.75, 1`. Each value has three independent generations. Cross-value judges receive three blinded diagrams; same-value judges receive the three replicates. A Sol analyst revises the control block after iteration 1 and recommends a final block after iteration 2.

## Viewer

Run the application and open `http://127.0.0.1:5173/experiments`:

```bash
npm --prefix scripts/new-diagram run dev
```

The viewer scans `<project>/.datasets` by default. Set `NEW_DIAGRAM_EXPERIMENTS_ROOT` to a different catalog root when experiments are stored centrally. It groups axis results by a configurable pass metric and threshold, lists every value and named replicate beneath its owning axis node, displays one replicate at a time with previous/next navigation, and exposes prompts, aggregate scores, and structural metrics without importing artifacts into a DiagramSet.

## Diagram datasets

The Experiments page can also curate diagrams from multiple projects into named datasets:

1. Select `+ dataset` and give the dataset a name.
2. Open an experiment replicate and select `add to dataset`.
3. Optionally enter comma-separated labels such as `accepted, semantic_zoom=high`.
4. Switch the tree from `EXPERIMENTS` to `DATASETS` to inspect one saved diagram at a time, edit its labels, or remove it.

Adding a diagram stores an immutable snapshot of its ASCII, metrics, code-entity ids, tested prompt, model, and experiment provenance. This keeps the curated item usable even if the source experiment moves or changes. Adding the same source replicate to one dataset twice is idempotent.

Dataset records are stored under `<NEW_DIAGRAM_EXPERIMENTS_ROOT>/diagram-collections` by default. Set `NEW_DIAGRAM_COLLECTIONS_ROOT` to isolate the writable collection store from the experiment catalog or to point multiple viewer instances at a shared collection directory.
