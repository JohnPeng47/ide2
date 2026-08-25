import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent
} from "react";
import { fetchRepositoryDirectory } from "../api";
import type {
  CodeEntityRecord,
  DiagramComponentRecord,
  DiagramRecord,
  RepositoryDirectoryListing
} from "../domain";
import {
  buildFileTree,
  diagramFileFilter,
  directoryPaths,
  flattenFileTree,
  flattenRepositoryListings,
  parentRepositoryPath,
  type FileTreeRow
} from "../fileTree";

type FileExplorerMode = "all" | "diagram";

export function FileExplorerPanel(props: {
  activeSetId: string;
  activeProjectId: string;
  codeEntities: readonly CodeEntityRecord[];
  artifact?: DiagramRecord | DiagramComponentRecord;
}) {
  const [mode, setMode] = useState<FileExplorerMode>("all");
  const [listings, setListings] = useState<Record<string, RepositoryDirectoryListing>>({});
  const listingsRef = useRef(listings);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [filterCollapsedPaths, setFilterCollapsedPaths] = useState<Set<string>>(new Set());
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const [directoryErrors, setDirectoryErrors] = useState<Record<string, string>>({});
  const [matchedFilterPaths, setMatchedFilterPaths] = useState<Set<string>>(new Set());
  const [unavailableFilterCount, setUnavailableFilterCount] = useState(0);
  const [filterLoading, setFilterLoading] = useState(false);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [focusedPath, setFocusedPath] = useState("");
  const controllers = useRef(new Map<string, AbortController>());
  const requests = useRef(new Map<string, Promise<RepositoryDirectoryListing>>());
  const requestGeneration = useRef(0);
  const filterGeneration = useRef(0);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  const updateListings = useCallback((next: Record<string, RepositoryDirectoryListing>) => {
    listingsRef.current = next;
    setListings(next);
  }, []);

  const loadDirectory = useCallback((directory: string): Promise<RepositoryDirectoryListing> => {
    const cached = listingsRef.current[directory];
    if (cached) return Promise.resolve(cached);
    const pending = requests.current.get(directory);
    if (pending) return pending;
    const generation = requestGeneration.current;
    const controller = new AbortController();
    controllers.current.set(directory, controller);
    setLoadingPaths((current) => new Set(current).add(directory));
    setDirectoryErrors((current) => {
      const next = { ...current };
      delete next[directory];
      return next;
    });
    const request = fetchRepositoryDirectory(props.activeSetId, directory, controller.signal)
      .then((listing) => {
        if (requestGeneration.current === generation) {
          updateListings({ ...listingsRef.current, [directory]: listing });
        }
        return listing;
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        if (requestGeneration.current === generation) {
          setDirectoryErrors((current) => ({
            ...current,
            [directory]: error instanceof Error ? error.message : "directory listing failed"
          }));
        }
        throw error;
      })
      .finally(() => {
        if (controllers.current.get(directory) === controller) controllers.current.delete(directory);
        if (requests.current.get(directory) === request) requests.current.delete(directory);
        if (requestGeneration.current === generation) {
          setLoadingPaths((current) => {
            const next = new Set(current);
            next.delete(directory);
            return next;
          });
        }
      });
    requests.current.set(directory, request);
    return request;
  }, [props.activeSetId, updateListings]);

  useEffect(() => {
    requestGeneration.current += 1;
    filterGeneration.current += 1;
    for (const controller of controllers.current.values()) controller.abort();
    controllers.current.clear();
    requests.current.clear();
    updateListings({});
    setExpandedPaths(new Set());
    setFilterCollapsedPaths(new Set());
    setLoadingPaths(new Set());
    setDirectoryErrors({});
    setMatchedFilterPaths(new Set());
    setUnavailableFilterCount(0);
    setFilterError(null);
    setFocusedPath("");
    void loadDirectory("").catch(() => undefined);
    return () => {
      requestGeneration.current += 1;
      filterGeneration.current += 1;
      for (const controller of controllers.current.values()) controller.abort();
    };
  }, [loadDirectory, props.activeSetId, updateListings]);

  const filter = useMemo(() => props.artifact ? diagramFileFilter(
    props.artifact,
    props.codeEntities,
    props.activeProjectId
  ) : {
    paths: [],
    unresolvedEntityIds: [],
    foreignEntityIds: [],
    invalidPaths: []
  }, [props.activeProjectId, props.artifact, props.codeEntities]);

  useEffect(() => {
    if (!props.artifact && mode === "diagram") setMode("all");
  }, [mode, props.artifact]);

  useEffect(() => {
    if (mode !== "diagram") return;
    const generation = ++filterGeneration.current;
    setFilterLoading(true);
    setFilterError(null);
    void (async () => {
      const byParent = new Map<string, string[]>();
      for (const filePath of filter.paths) {
        const parent = parentRepositoryPath(filePath);
        byParent.set(parent, [...(byParent.get(parent) ?? []), filePath]);
      }
      const matches = new Set<string>();
      let unavailable = 0;
      const failures: string[] = [];
      await Promise.all([...byParent.entries()].map(async ([parent, paths]) => {
        try {
          const listing = await loadDirectory(parent);
          const liveFiles = new Set(
            listing.entries.filter((entry) => entry.kind === "file").map((entry) => entry.path)
          );
          for (const filePath of paths) {
            if (liveFiles.has(filePath)) matches.add(filePath);
            else unavailable += 1;
          }
        } catch (error) {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            unavailable += paths.length;
            failures.push(error instanceof Error ? error.message : "directory listing failed");
          }
        }
      }));
      if (filterGeneration.current !== generation) return;
      setMatchedFilterPaths(matches);
      setUnavailableFilterCount(unavailable);
      setFilterError(failures[0] ?? null);
      setFilterLoading(false);
    })();
  }, [filter, loadDirectory, mode]);

  const filterTree = useMemo(
    () => buildFileTree([...matchedFilterPaths]),
    [matchedFilterPaths]
  );
  const filterExpandedPaths = useMemo(() => new Set(
    directoryPaths(filterTree).filter((directory) => !filterCollapsedPaths.has(directory))
  ), [filterCollapsedPaths, filterTree]);
  const rows = useMemo(() => mode === "all"
    ? flattenRepositoryListings(listings[""]?.entries ?? [], listings, expandedPaths)
    : flattenFileTree(filterTree, filterExpandedPaths), [
    expandedPaths,
    filterExpandedPaths,
    filterTree,
    listings,
    mode
  ]);

  useEffect(() => {
    if (rows.some((row) => row.path === focusedPath)) return;
    setFocusedPath(rows[0]?.path ?? "");
  }, [focusedPath, rows]);

  const isExpanded = (row: FileTreeRow): boolean => row.kind === "directory" && (
    mode === "all" ? expandedPaths.has(row.path) : filterExpandedPaths.has(row.path)
  );

  const toggleDirectory = (row: FileTreeRow) => {
    if (row.kind !== "directory") return;
    if (mode === "diagram") {
      setFilterCollapsedPaths((current) => {
        const next = new Set(current);
        if (next.has(row.path)) next.delete(row.path);
        else next.add(row.path);
        return next;
      });
      return;
    }
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(row.path)) {
        next.delete(row.path);
        controllers.current.get(row.path)?.abort();
      } else {
        next.add(row.path);
        void loadDirectory(row.path).catch(() => undefined);
      }
      return next;
    });
  };

  const focusRow = (path: string) => {
    setFocusedPath(path);
    requestAnimationFrame(() => rowRefs.current.get(path)?.focus());
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLDivElement>, row: FileTreeRow, index: number) => {
    if (event.key === "ArrowDown" && rows[index + 1]) {
      event.preventDefault();
      focusRow(rows[index + 1].path);
    } else if (event.key === "ArrowUp" && rows[index - 1]) {
      event.preventDefault();
      focusRow(rows[index - 1].path);
    } else if (event.key === "Home" && rows[0]) {
      event.preventDefault();
      focusRow(rows[0].path);
    } else if (event.key === "End" && rows.at(-1)) {
      event.preventDefault();
      focusRow(rows.at(-1)!.path);
    } else if (event.key === "ArrowRight" && row.kind === "directory") {
      event.preventDefault();
      if (!isExpanded(row)) toggleDirectory(row);
      else if (rows[index + 1]?.parentPath === row.path) focusRow(rows[index + 1].path);
    } else if (event.key === "ArrowLeft") {
      if (row.kind === "directory" && isExpanded(row)) {
        event.preventDefault();
        toggleDirectory(row);
      } else if (row.parentPath) {
        event.preventDefault();
        focusRow(row.parentPath);
      }
    } else if ((event.key === "Enter" || event.key === " ") && row.kind === "directory") {
      event.preventDefault();
      toggleDirectory(row);
    }
  };

  const omittedCount = filter.foreignEntityIds.length
    + filter.unresolvedEntityIds.length
    + filter.invalidPaths.length
    + unavailableFilterCount;
  const rootError = directoryErrors[""];
  const emptyMessage = mode === "diagram"
    ? filterLoading
      ? "Matching CodeEntity paths against the live checkout..."
      : "No files in this checkout match the active artifact's CodeEntities."
    : loadingPaths.has("")
      ? "Loading repository files..."
      : rootError ?? "This repository directory is empty.";

  return (
    <section className="file-explorer" aria-label="Repository files">
      <div className="file-explorer__mode-bar" role="group" aria-label="File tree filter">
        <div>
          <button
            type="button"
            className={mode === "all" ? "is-active" : ""}
            aria-pressed={mode === "all"}
            onClick={() => setMode("all")}
          >ALL FILES</button>
          <button
            type="button"
            className={mode === "diagram" ? "is-active" : ""}
            aria-pressed={mode === "diagram"}
            disabled={!props.artifact}
            title={props.artifact ? "Show files referenced by the active artifact" : "Open a diagram to filter its files"}
            onClick={() => setMode("diagram")}
          >DIAGRAM FILES</button>
        </div>
        <span aria-live="polite">{
          mode === "diagram"
            ? filterLoading ? "MATCHING" : `${matchedFilterPaths.size} MATCH${omittedCount ? ` · ${omittedCount} UNAVAILABLE` : ""}`
            : `${rows.length} VISIBLE`
        }</span>
      </div>
      <div
        className="file-tree-scroller"
        role="tree"
        aria-label={mode === "all" ? "All repository files" : "Diagram file filter results"}
        aria-busy={loadingPaths.has("") || filterLoading}
      >
        {rows.map((row, index) => {
          const expanded = isExpanded(row);
          const loading = loadingPaths.has(row.path);
          const error = directoryErrors[row.path];
          return (
            <div
              ref={(node) => {
                if (node) rowRefs.current.set(row.path, node);
                else rowRefs.current.delete(row.path);
              }}
              key={row.path}
              className={`file-tree-row file-tree-row--${row.kind}`}
              role="treeitem"
              aria-level={row.level}
              aria-expanded={row.kind === "directory" ? expanded : undefined}
              tabIndex={focusedPath === row.path ? 0 : -1}
              title={row.path}
              data-path={row.path}
              onFocus={() => setFocusedPath(row.path)}
              onClick={() => {
                focusRow(row.path);
                if (row.kind === "directory") toggleDirectory(row);
              }}
              onKeyDown={(event) => onRowKeyDown(event, row, index)}
            >
              <span className="file-tree-row__prefix" aria-hidden="true">{row.prefix}</span>
              <span className="file-tree-row__toggle" aria-hidden="true">{
                row.kind === "directory" ? expanded ? "[-]" : "[+]" : "   "
              }</span>
              <span className="file-tree-row__name">{row.name}</span>
              {loading ? <em>loading</em> : null}
              {error ? (
                <button
                  type="button"
                  className="file-tree-retry"
                  onClick={(event) => {
                    event.stopPropagation();
                    void loadDirectory(row.path).catch(() => undefined);
                  }}
                >retry</button>
              ) : null}
            </div>
          );
        })}
        {rows.length === 0 ? (
          <div className="file-tree-empty">
            <p>{emptyMessage}</p>
            {mode === "all" && rootError ? (
              <button type="button" onClick={() => void loadDirectory("").catch(() => undefined)}>retry</button>
            ) : null}
          </div>
        ) : null}
        {mode === "diagram" && filterError ? (
          <p className="file-tree-warning" role="alert">Some repository paths could not be checked: {filterError}</p>
        ) : null}
      </div>
    </section>
  );
}
