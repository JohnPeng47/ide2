import {
  useEffect,
  useMemo,
  useState,
  type FormEvent
} from "react";
import {
  addDiagramDatasetItem,
  createDiagramDataset,
  fetchDiagramDatasetItem,
  fetchDiagramDatasets,
  fetchExperimentArtifact,
  fetchExperiments,
  removeDiagramDatasetItem,
  updateDiagramDatasetItemLabels
} from "../api";
import type { DiagramDatasetCatalogSnapshot, DiagramDatasetItemRecord, DiagramDatasetSummary } from "../../../../domain/studio/datasets/datasetDomain";
import type {
  ExperimentAxisSummary,
  ExperimentCatalogSnapshot,
  ExperimentDiagramArtifact,
  ExperimentDiagramSummary,
  ExperimentIterationSummary,
  ExperimentMetricKey,
  ExperimentSummary
} from "../../../../domain/studio/experiments/experimentDomain";

interface ExperimentSelection {
  catalogId: string;
  axisId: string;
  iteration: number;
  value: number;
  replicate: number;
}

interface DatasetSelection {
  datasetId: string;
  itemId: string;
}

const METRICS: Array<{ id: ExperimentMetricKey; label: string }> = [
  { id: "pairwiseOrderingAccuracy", label: "Pairwise ordering" },
  { id: "exactOrderingAccuracy", label: "Exact ordering" },
  { id: "distinguishabilityScore", label: "Distinguishability" }
];

function score(iteration: ExperimentIterationSummary, metric: ExperimentMetricKey): number | undefined {
  return iteration.aggregate?.[metric];
}

function percent(value: number | undefined): string {
  return value === undefined ? "--" : `${Math.round(value * 100)}%`;
}

function initialSelection(snapshot: ExperimentCatalogSnapshot): ExperimentSelection | null {
  const experiment = snapshot.experiments[0];
  const axis = experiment?.axes[0];
  const iteration = axis?.iterations[0];
  const diagram = iteration?.diagrams[0];
  return experiment && axis && iteration && diagram ? {
    catalogId: experiment.catalogId,
    axisId: axis.id,
    iteration: iteration.number,
    value: diagram.value,
    replicate: diagram.replicate
  } : null;
}

function locate(snapshot: ExperimentCatalogSnapshot, selection: ExperimentSelection | null): {
  experiment?: ExperimentSummary;
  axis?: ExperimentAxisSummary;
  iteration?: ExperimentIterationSummary;
} {
  const experiment = snapshot.experiments.find((item) => item.catalogId === selection?.catalogId);
  const axis = experiment?.axes.find((item) => item.id === selection?.axisId);
  const iteration = axis?.iterations.find((item) => item.number === selection?.iteration);
  return { experiment, axis, iteration };
}

function diagramSelection(selection: ExperimentSelection, diagram: ExperimentDiagramSummary): boolean {
  return diagram.axisId === selection.axisId
    && diagram.iteration === selection.iteration
    && diagram.value === selection.value
    && diagram.replicate === selection.replicate;
}

function ExperimentTree(props: {
  snapshot: ExperimentCatalogSnapshot;
  metric: ExperimentMetricKey;
  threshold: number;
  selection: ExperimentSelection | null;
  onSelect: (selection: ExperimentSelection) => void;
}) {
  const projects = useMemo(() => {
    const grouped = new Map<string, ExperimentSummary[]>();
    for (const experiment of props.snapshot.experiments) {
      grouped.set(experiment.project.id, [...(grouped.get(experiment.project.id) ?? []), experiment]);
    }
    return [...grouped.values()];
  }, [props.snapshot]);

  const axisLine = (
    experiment: ExperimentSummary,
    axis: ExperimentAxisSummary,
    iteration: ExperimentIterationSummary,
    prefix: string,
    last: boolean
  ) => {
    const current = props.selection?.catalogId === experiment.catalogId
      && props.selection.axisId === axis.id
      && props.selection.iteration === iteration.number;
    const diagramsByValue = iteration.values.map((value) => ({
      value,
      diagrams: iteration.diagrams.filter((diagram) => diagram.value === value)
    })).filter((item) => item.diagrams.length);
    return (
      <div className="experiment-tree-axis" key={`${experiment.catalogId}:${iteration.number}:${axis.id}`}>
        <button
          type="button"
          className={`experiment-tree-line experiment-tree-axis-line${current ? " is-current" : ""}`}
          data-axis-id={axis.id}
          data-iteration={iteration.number}
          aria-current={current ? "true" : undefined}
          onClick={() => {
            const first = diagramsByValue[0]?.diagrams[0];
            if (first) props.onSelect({ catalogId: experiment.catalogId, axisId: axis.id, iteration: iteration.number, value: first.value, replicate: first.replicate });
          }}
        >
          <span className="experiment-tree-prefix">{prefix}{last ? "`-- " : "+-- "}</span>
          <strong>{axis.label}</strong>
          <em>{percent(score(iteration, props.metric))}</em>
        </button>
        {diagramsByValue.map((valueGroup, valueIndex) => {
          const valueLast = valueIndex === diagramsByValue.length - 1;
          const valuePrefix = `${prefix}${last ? "    " : "|   "}`;
          const valueCurrent = current && props.selection?.value === valueGroup.value;
          return (
            <div key={valueGroup.value}>
              <button
                type="button"
                className={`experiment-tree-line experiment-tree-value${valueCurrent ? " is-current" : ""}`}
                data-value={valueGroup.value.toFixed(2)}
                onClick={() => props.onSelect({ catalogId: experiment.catalogId, axisId: axis.id, iteration: iteration.number, value: valueGroup.value, replicate: valueGroup.diagrams[0].replicate })}
              >
                <span className="experiment-tree-prefix">{valuePrefix}{valueLast ? "`-- " : "+-- "}</span>
                <strong>value {valueGroup.value.toFixed(2)}</strong>
                <span>{valueGroup.diagrams.length} replicates</span>
              </button>
              {valueGroup.diagrams.map((diagram, diagramIndex) => {
                const diagramPrefix = `${valuePrefix}${valueLast ? "    " : "|   "}`;
                const diagramLast = diagramIndex === valueGroup.diagrams.length - 1;
                const diagramCurrent = current
                  && props.selection?.value === diagram.value
                  && props.selection.replicate === diagram.replicate;
                return (
                  <button
                    type="button"
                    className={`experiment-tree-line experiment-tree-replicate${diagramCurrent ? " is-current" : ""}`}
                    data-replicate={diagram.replicate}
                    data-diagram-name={diagram.name}
                    key={diagram.replicate}
                    title={diagram.name}
                    aria-current={diagramCurrent ? "true" : undefined}
                    onClick={() => props.onSelect({ catalogId: experiment.catalogId, axisId: axis.id, iteration: iteration.number, value: diagram.value, replicate: diagram.replicate })}
                  >
                    <span className="experiment-tree-prefix">{diagramPrefix}{diagramLast ? "`-- " : "+-- "}</span>
                    <strong>r{diagram.replicate}</strong>
                    <span>{diagram.name}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="experiment-tree" data-testid="experiment-tree">
      {projects.map((experiments) => {
        const project = experiments[0].project;
        return (
          <section className="experiment-tree-project" key={project.id}>
            <div className="experiment-tree-project-title">PROJECT {project.name}</div>
            {experiments.map((experiment, experimentIndex) => {
              const experimentLast = experimentIndex === experiments.length - 1;
              return (
                <div key={experiment.catalogId}>
                  <div className="experiment-tree-line experiment-tree-experiment">
                    <span className="experiment-tree-prefix">{experimentLast ? "`-- " : "+-- "}</span>
                    <strong>{experiment.id}</strong>
                    <em>{experiment.status.toUpperCase()}</em>
                  </div>
                  {experiment.axes[0]?.iterations.map((iteration, iterationIndex) => {
                    const iterationLast = iterationIndex === experiment.axes[0].iterations.length - 1;
                    const basePrefix = experimentLast ? "    " : "|   ";
                    const passing = experiment.axes.filter((axis) => {
                      const target = axis.iterations.find((item) => item.number === iteration.number);
                      return (target ? score(target, props.metric) : undefined) !== undefined
                        && score(target!, props.metric)! >= props.threshold;
                    });
                    const below = experiment.axes.filter((axis) => {
                      const target = axis.iterations.find((item) => item.number === iteration.number);
                      const value = target ? score(target, props.metric) : undefined;
                      return value !== undefined && value < props.threshold;
                    });
                    const pending = experiment.axes.filter((axis) => !passing.includes(axis) && !below.includes(axis));
                    const groups = [
                      { label: `PASS >= ${Math.round(props.threshold * 100)}%`, axes: passing, state: "pass" },
                      { label: `BELOW ${Math.round(props.threshold * 100)}%`, axes: below, state: "below" },
                      { label: "PENDING SCORE", axes: pending, state: "pending" }
                    ];
                    return (
                      <div key={iteration.number}>
                        <div className="experiment-tree-line experiment-tree-iteration">
                          <span className="experiment-tree-prefix">{basePrefix}{iterationLast ? "`-- " : "+-- "}</span>
                          <strong>ITERATION {iteration.number}</strong>
                          <span>{iteration.values.length} values</span>
                        </div>
                        {groups.map((group, groupIndex) => {
                          const groupLast = groupIndex === groups.length - 1;
                          const groupPrefix = `${basePrefix}${iterationLast ? "    " : "|   "}`;
                          return (
                            <div key={group.label}>
                              <div className={`experiment-tree-line experiment-tree-group is-${group.state}`}>
                                <span className="experiment-tree-prefix">{groupPrefix}{groupLast ? "`-- " : "+-- "}</span>
                                <strong>{group.label}</strong>
                                <span>[{group.axes.length}]</span>
                              </div>
                              {group.axes.map((axis, axisIndex) => axisLine(
                                experiment,
                                axis,
                                axis.iterations.find((item) => item.number === iteration.number)!,
                                `${groupPrefix}${groupLast ? "    " : "|   "}`,
                                axisIndex === group.axes.length - 1
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

function DatasetTree(props: {
  catalog: DiagramDatasetCatalogSnapshot;
  selection: DatasetSelection | null;
  onSelect: (selection: DatasetSelection) => void;
}) {
  if (!props.catalog.datasets.length) {
    return <p className="empty-copy">Create a dataset, then add the diagram currently open in Experiments.</p>;
  }
  return (
    <div className="experiment-tree dataset-tree" data-testid="dataset-tree">
      <div className="experiment-tree-project-title">DIAGRAM DATASETS</div>
      {props.catalog.datasets.map((dataset, datasetIndex) => {
        const datasetLast = datasetIndex === props.catalog.datasets.length - 1;
        return (
          <section key={dataset.id}>
            <div className="experiment-tree-line dataset-tree-dataset">
              <span className="experiment-tree-prefix">{datasetLast ? "`-- " : "+-- "}</span>
              <strong>{dataset.name}</strong>
              <em>{dataset.itemCount} ITEMS</em>
            </div>
            {dataset.items.map((item, itemIndex) => {
              const current = props.selection?.datasetId === dataset.id && props.selection.itemId === item.id;
              return (
                <button
                  type="button"
                  className={`experiment-tree-line dataset-tree-item${current ? " is-current" : ""}`}
                  data-dataset-item-id={item.id}
                  key={item.id}
                  title={item.name}
                  onClick={() => props.onSelect({ datasetId: dataset.id, itemId: item.id })}
                >
                  <span className="experiment-tree-prefix">{datasetLast ? "    " : "|   "}{itemIndex === dataset.items.length - 1 ? "`-- " : "+-- "}</span>
                  <strong>{String(itemIndex + 1).padStart(2, "0")}</strong>
                  <span>{item.name}</span>
                  {item.labels.length ? <em>{item.labels.join(" / ")}</em> : null}
                </button>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

function CreateDatasetDialog(props: {
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await props.onCreate(name);
  };
  return (
    <div className="dataset-dialog-backdrop" role="presentation">
      <form className="dataset-dialog" data-testid="create-dataset-dialog" onSubmit={(event) => void submit(event)}>
        <header><div><span className="eyebrow">NEW COLLECTION</span><h2>Create diagram dataset</h2></div><button type="button" disabled={props.busy} onClick={props.onClose}>close</button></header>
        <label><span>DATASET NAME</span><input autoFocus value={name} maxLength={120} placeholder="Topology training examples" onChange={(event) => setName(event.target.value)} /></label>
        {props.error ? <p className="inline-error" role="alert">{props.error}</p> : null}
        <footer><span>ASCII and provenance are snapshotted when added.</span><button type="button" className="button" disabled={props.busy} onClick={props.onClose}>cancel</button><button type="submit" className="button button--primary" disabled={props.busy || !name.trim()}>{props.busy ? "creating..." : "create dataset"}</button></footer>
      </form>
    </div>
  );
}

function AddToDatasetDialog(props: {
  datasets: DiagramDatasetSummary[];
  defaultDatasetId?: string;
  diagramName: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onAdd: (datasetId: string, labels: string[]) => Promise<void>;
}) {
  const [datasetId, setDatasetId] = useState(props.defaultDatasetId ?? props.datasets[0]?.id ?? "");
  const [labels, setLabels] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await props.onAdd(datasetId, labels.split(",").map((label) => label.trim()).filter(Boolean));
  };
  return (
    <div className="dataset-dialog-backdrop" role="presentation">
      <form className="dataset-dialog" data-testid="add-to-dataset-dialog" onSubmit={(event) => void submit(event)}>
        <header><div><span className="eyebrow">SNAPSHOT DIAGRAM</span><h2>Add to dataset</h2><p>{props.diagramName}</p></div><button type="button" disabled={props.busy} onClick={props.onClose}>close</button></header>
        <label><span>DATASET</span><select value={datasetId} onChange={(event) => setDatasetId(event.target.value)}>{props.datasets.map((dataset) => <option value={dataset.id} key={dataset.id}>{dataset.name} ({dataset.itemCount})</option>)}</select></label>
        <label><span>OPTIONAL LABELS</span><input value={labels} placeholder="accepted, semantic_zoom=high" onChange={(event) => setLabels(event.target.value)} /><small>Comma-separated tags or key=value labels.</small></label>
        {props.error ? <p className="inline-error" role="alert">{props.error}</p> : null}
        <footer><span>Duplicate source diagrams are added only once.</span><button type="button" className="button" disabled={props.busy} onClick={props.onClose}>cancel</button><button type="submit" className="button button--primary" disabled={props.busy || !datasetId}>{props.busy ? "adding..." : "add diagram"}</button></footer>
      </form>
    </div>
  );
}

function DiagramCard({ diagram }: { diagram: ExperimentDiagramArtifact }) {
  return (
    <article className="experiment-diagram-card" data-replicate-card={diagram.replicate}>
      <header>
        <div><span>R{diagram.replicate}</span><strong>{diagram.name}</strong></div>
        <code>{diagram.metrics.rows}x{diagram.metrics.columns}</code>
      </header>
      <div className="experiment-ascii-stage"><pre>{diagram.artifact.ascii}</pre></div>
      <footer>
        <span>{diagram.metrics.arrows} arrows</span>
        <span>{diagram.metrics.boxJunctions} junctions</span>
        <span>{diagram.metrics.implementationTokens} implementation tokens</span>
      </footer>
    </article>
  );
}

function DatasetDiagramCard({ item }: { item: DiagramDatasetItemRecord }) {
  return (
    <article className="experiment-diagram-card" data-dataset-card={item.id}>
      <header><div><span>SNAPSHOT</span><strong>{item.name}</strong></div><code>{item.metrics.rows}x{item.metrics.columns}</code></header>
      <div className="experiment-ascii-stage"><pre>{item.ascii}</pre></div>
      <footer><span>{item.metrics.arrows} arrows</span><span>{item.metrics.boxJunctions} junctions</span><span>{item.modelId}</span></footer>
    </article>
  );
}

export function ExperimentViewerPage(props: { onStudio: () => void; onMapping: () => void }) {
  const [snapshot, setSnapshot] = useState<ExperimentCatalogSnapshot | null>(null);
  const [datasets, setDatasets] = useState<DiagramDatasetCatalogSnapshot>({ datasets: [] });
  const [selection, setSelection] = useState<ExperimentSelection | null>(null);
  const [datasetSelection, setDatasetSelection] = useState<DatasetSelection | null>(null);
  const [datasetItem, setDatasetItem] = useState<DiagramDatasetItemRecord | null>(null);
  const [treeMode, setTreeMode] = useState<"experiments" | "datasets">("experiments");
  const [metric, setMetric] = useState<ExperimentMetricKey>("pairwiseOrderingAccuracy");
  const [threshold, setThreshold] = useState(0.75);
  const [artifacts, setArtifacts] = useState<ExperimentDiagramArtifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [datasetLoading, setDatasetLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"create" | "add" | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [datasetStatus, setDatasetStatus] = useState("");
  const [labelDraft, setLabelDraft] = useState("");

  useEffect(() => {
    void Promise.all([fetchExperiments(), fetchDiagramDatasets()]).then(([next, nextDatasets]) => {
      setSnapshot(next);
      setDatasets(nextDatasets);
      setSelection(initialSelection(next));
      setError(null);
    }).catch((caught) => setError(caught instanceof Error ? caught.message : "experiment catalog failed"))
      .finally(() => setLoading(false));
  }, []);

  const located = snapshot ? locate(snapshot, selection) : {};
  useEffect(() => {
    if (!selection || !located.iteration) { setArtifacts([]); return; }
    const targets = located.iteration.diagrams.filter((diagram) => diagramSelection(selection, diagram));
    let cancelled = false;
    setLoading(true);
    void Promise.all(targets.map((diagram) => fetchExperimentArtifact({
      catalogId: selection.catalogId,
      axisId: selection.axisId,
      iteration: selection.iteration,
      value: diagram.value,
      replicate: diagram.replicate
    }))).then((next) => {
      if (!cancelled) { setArtifacts(next.sort((left, right) => left.replicate - right.replicate)); setError(null); }
    }).catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "diagram load failed"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selection?.catalogId, selection?.axisId, selection?.iteration, selection?.value, selection?.replicate, located.iteration]);

  useEffect(() => {
    if (!datasetSelection) { setDatasetItem(null); return; }
    let cancelled = false;
    setDatasetLoading(true);
    void fetchDiagramDatasetItem(datasetSelection.datasetId, datasetSelection.itemId)
      .then((item) => {
        if (!cancelled) {
          setDatasetItem(item);
          setLabelDraft(item.labels.join(", "));
          setError(null);
        }
      })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "dataset item load failed"); })
      .finally(() => { if (!cancelled) setDatasetLoading(false); });
    return () => { cancelled = true; };
  }, [datasetSelection?.datasetId, datasetSelection?.itemId]);

  const aggregate = located.iteration?.aggregate;
  const valueDiagrams = (located.iteration?.diagrams ?? [])
    .filter((diagram) => diagram.value === selection?.value)
    .sort((left, right) => left.replicate - right.replicate);
  const replicateIndex = valueDiagrams.findIndex((diagram) => diagram.replicate === selection?.replicate);
  const selectReplicate = (offset: number) => {
    if (!selection || !valueDiagrams.length) return;
    const next = valueDiagrams[replicateIndex + offset];
    if (next) setSelection({ ...selection, replicate: next.replicate });
  };
  const replaceDataset = (next: DiagramDatasetSummary) => {
    setDatasets((current) => ({
      datasets: [next, ...current.datasets.filter((dataset) => dataset.id !== next.id)]
    }));
  };
  const createDataset = async (name: string) => {
    setDialogBusy(true);
    setDialogError(null);
    try {
      const created = await createDiagramDataset(name);
      replaceDataset(created);
      setDialog(null);
      setTreeMode("datasets");
      setDatasetStatus(`created ${created.name}`);
    } catch (caught) {
      setDialogError(caught instanceof Error ? caught.message : "dataset creation failed");
    } finally {
      setDialogBusy(false);
    }
  };
  const addCurrentDiagram = async (datasetId: string, labels: string[]) => {
    if (!selection || !artifacts[0]) return;
    setDialogBusy(true);
    setDialogError(null);
    try {
      const result = await addDiagramDatasetItem(datasetId, {
        source: {
          catalogId: selection.catalogId,
          axisId: selection.axisId,
          iteration: selection.iteration,
          value: selection.value,
          replicate: selection.replicate
        },
        labels
      });
      replaceDataset(result.dataset);
      setDialog(null);
      setDatasetStatus(result.added ? `added ${result.item.name}` : `${result.item.name} is already in ${result.dataset.name}`);
    } catch (caught) {
      setDialogError(caught instanceof Error ? caught.message : "adding diagram failed");
    } finally {
      setDialogBusy(false);
    }
  };
  const saveLabels = async () => {
    if (!datasetSelection || !datasetItem) return;
    const labels = labelDraft.split(",").map((label) => label.trim()).filter(Boolean);
    setDatasetLoading(true);
    try {
      const next = await updateDiagramDatasetItemLabels(datasetSelection.datasetId, datasetSelection.itemId, labels);
      replaceDataset(next);
      setDatasetItem({ ...datasetItem, labels });
      setDatasetStatus("labels saved");
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "label update failed");
    } finally {
      setDatasetLoading(false);
    }
  };
  const removeDatasetItem = async () => {
    if (!datasetSelection || !datasetItem) return;
    setDatasetLoading(true);
    try {
      const next = await removeDiagramDatasetItem(datasetSelection.datasetId, datasetSelection.itemId);
      replaceDataset(next);
      const replacement = next.items[0];
      setDatasetSelection(replacement ? { datasetId: next.id, itemId: replacement.id } : null);
      setDatasetItem(null);
      setDatasetStatus(`removed ${datasetItem.name}`);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "diagram removal failed");
    } finally {
      setDatasetLoading(false);
    }
  };
  return (
    <main className="experiment-shell">
      <header className="studio-header experiment-header">
        <div className="brand"><span className="brand-mark">ND</span><div><h1>NEW DIAGRAM</h1><p>experiment viewer</p></div></div>
        <div className="experiment-header-summary">
          <span className="eyebrow">EXPERIMENT CATALOG</span>
          <strong>{snapshot?.experiments.length ?? 0} experiments / {snapshot?.experiments.reduce((sum, item) => sum + item.axes.length, 0) ?? 0} axes</strong>
        </div>
        <nav className="screen-tabs" aria-label="Application pages">
          <button type="button" onClick={props.onStudio}>STUDIO</button>
          <button type="button" className="is-active">EXPERIMENTS</button>
          <button type="button" onClick={props.onMapping}>MAPPING</button>
        </nav>
      </header>
      {error && !snapshot ? <section className="center-state"><h1>EXPERIMENTS UNAVAILABLE</h1><p>{error}</p></section> : null}
      {!error && !loading && snapshot?.experiments.length === 0 && datasets.datasets.length === 0 ? <section className="center-state"><h1>NO EXPERIMENTS OR DATASETS</h1><p>No experiment manifests or diagram datasets were found.</p><button type="button" className="button button--primary" onClick={() => setDialog("create")}>create dataset</button></section> : null}
      {(snapshot?.experiments.length || datasets.datasets.length) ? (
        <div className="experiment-layout">
          <aside className="experiment-tree-panel tree-panel">
            <header className="experiment-panel-header"><div><span className="eyebrow">COLLECTIONS</span><h2>{treeMode === "experiments" ? "Experiment tree" : "Diagram datasets"}</h2></div><button type="button" className="button dataset-create" onClick={() => { setDialogError(null); setDialog("create"); }}>+ dataset</button></header>
            <div className="experiment-tree-mode" role="tablist" aria-label="Tree source">
              <button type="button" role="tab" aria-selected={treeMode === "experiments"} className={treeMode === "experiments" ? "is-active" : ""} onClick={() => setTreeMode("experiments")}>EXPERIMENTS</button>
              <button type="button" role="tab" aria-selected={treeMode === "datasets"} className={treeMode === "datasets" ? "is-active" : ""} onClick={() => setTreeMode("datasets")}>DATASETS <span>{datasets.datasets.length}</span></button>
            </div>
            {treeMode === "experiments" && snapshot ? <>
              <div className="experiment-tree-controls">
                <label><span>PASS METRIC</span><select value={metric} onChange={(event) => setMetric(event.target.value as ExperimentMetricKey)}>{METRICS.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
                <label><span>THRESHOLD</span><select value={threshold} onChange={(event) => setThreshold(Number(event.target.value))}><option value={0.5}>50%</option><option value={0.75}>75%</option><option value={0.9}>90%</option></select></label>
              </div>
              <ExperimentTree snapshot={snapshot} metric={metric} threshold={threshold} selection={selection} onSelect={(next) => { setSelection(next); setTreeMode("experiments"); }} />
            </> : <DatasetTree catalog={datasets} selection={datasetSelection} onSelect={(next) => { setDatasetSelection(next); setTreeMode("datasets"); }} />}
            {datasetStatus ? <div className="dataset-status" role="status">{datasetStatus}</div> : null}
          </aside>
          <section className="experiment-viewer-panel">
            {treeMode === "datasets" ? <>
              <header className="experiment-panel-header"><div><span className="eyebrow">DATASET SNAPSHOT</span><h2>{datasetItem?.name ?? "Select a dataset diagram"}</h2></div></header>
              {datasetLoading ? <div className="experiment-loading"><span className="pulse" /> loading dataset diagram</div> : null}
              {!datasetLoading && datasetItem ? <div className="experiment-diagram-grid count-1"><DatasetDiagramCard item={datasetItem} /></div> : null}
              {!datasetLoading && !datasetItem ? <p className="empty-copy dataset-view-empty">Select a diagram from the dataset tree, or return to Experiments to add one.</p> : null}
            </> : <>
              <header className="experiment-panel-header">
                <div><span className="eyebrow">SINGLE DIAGRAM RESULT</span><h2>{located.axis?.label ?? "Select an axis"} / iteration {located.iteration?.number ?? "-"} / value {selection?.value.toFixed(2) ?? "-"}</h2></div>
                <div className="experiment-viewer-actions">
                  <div className="experiment-replicate-nav" aria-label="Replicate navigation">
                    <button type="button" disabled={replicateIndex <= 0} onClick={() => selectReplicate(-1)} aria-label="Previous replicate">&lt;</button>
                    <span>REPLICATE {replicateIndex + 1} OF {valueDiagrams.length}</span>
                    <button type="button" disabled={replicateIndex < 0 || replicateIndex >= valueDiagrams.length - 1} onClick={() => selectReplicate(1)} aria-label="Next replicate">&gt;</button>
                  </div>
                  <button type="button" className="button button--primary dataset-add-current" disabled={!artifacts[0]} onClick={() => { setDialogError(null); setDialog(datasets.datasets.length ? "add" : "create"); }}>{datasets.datasets.length ? "add to dataset" : "create dataset"}</button>
                </div>
              </header>
              {loading ? <div className="experiment-loading"><span className="pulse" /> loading diagrams</div> : null}
              {!loading && artifacts.length ? <div className="experiment-diagram-grid count-1">{artifacts.map((diagram) => <DiagramCard diagram={diagram} key={diagram.replicate} />)}</div> : null}
            </>}
            {error ? <p className="experiment-error" role="alert">{error}</p> : null}
          </section>
          <aside className="experiment-inspector">
            {treeMode === "datasets" ? <>
              <header className="experiment-panel-header"><div><span className="eyebrow">DATASET ITEM</span><h2>{datasets.datasets.find((dataset) => dataset.id === datasetSelection?.datasetId)?.name ?? "No selection"}</h2></div></header>
              {datasetItem ? <div className="experiment-inspector-body dataset-item-inspector">
                <section><h3>PROVENANCE</h3><p>{datasetItem.source.projectName}<br />{datasetItem.source.experimentId}<br />{datasetItem.source.axisLabel} / iteration {datasetItem.source.iteration} / value {datasetItem.source.value.toFixed(2)} / replicate {datasetItem.source.replicate}</p></section>
                <section className="dataset-label-editor"><h3>LABELS</h3><input value={labelDraft} placeholder="accepted, topology=high" onChange={(event) => setLabelDraft(event.target.value)} /><small>Comma-separated tags or key=value labels.</small><button type="button" className="button button--primary" disabled={datasetLoading} onClick={() => void saveLabels()}>save labels</button></section>
                <details><summary>TESTED PROMPT</summary><pre>{datasetItem.testedPrompt || "Prompt unavailable"}</pre></details>
                <section><h3>SNAPSHOT</h3><p>{datasetItem.modelId}<br />{datasetItem.codeEntityIds.length} CodeEntities<br />added {new Date(datasetItem.addedAt).toLocaleString()}</p></section>
                <button type="button" className="button dataset-remove-item" disabled={datasetLoading} onClick={() => void removeDatasetItem()}>remove from dataset</button>
              </div> : <p className="empty-copy">Select a dataset diagram to inspect its labels and provenance.</p>}
            </> : <>
              <header className="experiment-panel-header"><div><span className="eyebrow">RESULT INSPECTOR</span><h2>{located.axis?.diagramSetName ?? "No selection"}</h2></div></header>
              {aggregate ? (
              <div className="experiment-inspector-body">
                <section className="experiment-score-grid">
                  <div><span>ORDERING</span><strong>{percent(aggregate.pairwiseOrderingAccuracy)}</strong></div>
                  <div><span>EXACT</span><strong>{percent(aggregate.exactOrderingAccuracy)}</strong></div>
                  <div><span>DISTINGUISH</span><strong>{percent(aggregate.distinguishabilityScore)}</strong></div>
                  <div><span>OFF-AXIS</span><strong>{percent(aggregate.meanOffAxisChange)}</strong></div>
                </section>
                <section><h3>AXIS CONTROL</h3><p>{located.axis?.controls}</p></section>
                <details open><summary>TESTED PROMPT</summary><pre>{aggregate.prompt}</pre></details>
                {located.iteration?.analysis ? <details><summary>SOL RECOMMENDATION</summary><pre>{located.iteration.analysis.revisedPromptBlock}</pre></details> : null}
                {selection ? <section><h3>VALUE METRICS</h3><dl className="experiment-metrics">{Object.entries(aggregate.metricMeansByValue[selection.value.toFixed(2)] ?? {}).map(([name, value]) => <div key={name}><dt>{name.replaceAll(/([A-Z])/g, " $1")}</dt><dd>{typeof value === "number" ? Math.round(value * 1000) / 1000 : value}</dd></div>)}</dl></section> : null}
              </div>
              ) : <p className="empty-copy">This iteration has not been analyzed yet.</p>}
            </>}
          </aside>
        </div>
      ) : null}
      {dialog === "create" ? <CreateDatasetDialog busy={dialogBusy} error={dialogError} onClose={() => setDialog(null)} onCreate={createDataset} /> : null}
      {dialog === "add" && artifacts[0] ? <AddToDatasetDialog datasets={datasets.datasets} defaultDatasetId={datasets.datasets[0]?.id} diagramName={artifacts[0].name} busy={dialogBusy} error={dialogError} onClose={() => setDialog(null)} onAdd={addCurrentDiagram} /> : null}
    </main>
  );
}
