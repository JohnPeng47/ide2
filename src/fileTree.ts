import type {
  CodeEntitiesSetRecord,
  CodeEntityRecord,
  DiagramCodeEntityMapRecord,
  DiagramComponentRecord,
  DiagramRecord,
  DiagramSetRecord,
  RepositoryDirectoryListing,
  RepositoryEntry
} from "./domain";

export interface DiagramFileFilter {
  paths: string[];
  entitiesByPath: Record<string, DiagramFileEntityReference[]>;
  unresolvedEntityIds: string[];
  foreignEntityIds: string[];
  invalidPaths: string[];
}

export interface DiagramFileEntityReference {
  entityId: string;
  handle: string;
  label: string;
  sourceRangeIndex: number;
}

export interface DiagramSetFileEntityReference extends DiagramFileEntityReference {
  diagramSetId: string;
  diagramId: string;
}

export interface DiagramSetFileIndex {
  paths: string[];
  labels: Array<{ diagramSetId: string; label: string; name: string }>;
  labelsByPath: Record<string, string[]>;
  entitiesByPath: Record<string, DiagramSetFileEntityReference[]>;
  unresolvedEntityIds: string[];
  foreignEntityIds: string[];
  invalidPaths: string[];
}

export interface FileTreeNode extends RepositoryEntry {
  children: FileTreeNode[];
}

export interface FileTreeRow extends RepositoryEntry {
  level: number;
  parentPath: string;
  prefix: string;
}

export function normalizeRepositoryPath(input: string): string | null {
  if (!input || input.includes("\0")) return null;
  const normalizedSeparators = input.replaceAll("\\", "/");
  if (normalizedSeparators.startsWith("/") || /^[a-zA-Z]:\//.test(normalizedSeparators)) {
    return null;
  }
  const segments: string[] = [];
  for (const segment of normalizedSeparators.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") return null;
    segments.push(segment);
  }
  return segments.length ? segments.join("/") : null;
}

export function compareRepositoryEntries(left: RepositoryEntry, right: RepositoryEntry): number {
  if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
  return left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
    || left.path.localeCompare(right.path);
}

export function diagramFileFilter(
  artifact: DiagramRecord | DiagramComponentRecord,
  codeEntities: readonly CodeEntityRecord[],
  activeProjectId: string
): DiagramFileFilter {
  const byId = new Map(codeEntities.map((entity) => [entity.id, entity]));
  const paths = new Set<string>();
  const entitiesByPath = new Map<string, DiagramFileEntityReference[]>();
  const unresolvedEntityIds: string[] = [];
  const foreignEntityIds: string[] = [];
  const invalidPaths: string[] = [];
  for (const entityId of new Set(artifact.codeEntityIds)) {
    const entity = byId.get(entityId);
    if (!entity) {
      unresolvedEntityIds.push(entityId);
      continue;
    }
    if (!entity.origin || entity.origin.projectId !== activeProjectId) {
      foreignEntityIds.push(entityId);
      continue;
    }
    for (const [sourceRangeIndex, range] of entity.sourceRanges.entries()) {
      const path = normalizeRepositoryPath(range.path);
      if (!path) {
        invalidPaths.push(range.path);
        continue;
      }
      paths.add(path);
      const references = entitiesByPath.get(path) ?? [];
      if (!references.some((reference) => reference.entityId === entity.id)) {
        references.push({
          entityId: entity.id,
          handle: entity.handle,
          label: entity.label,
          sourceRangeIndex
        });
        entitiesByPath.set(path, references);
      }
    }
  }
  return {
    paths: [...paths].sort((left, right) => left.localeCompare(right)),
    entitiesByPath: Object.fromEntries(
      [...entitiesByPath.entries()].sort(([left], [right]) => left.localeCompare(right))
    ),
    unresolvedEntityIds,
    foreignEntityIds,
    invalidPaths
  };
}

/** Compact, stable labels for displaying DiagramSets beside repository nodes. */
export function diagramSetFileLabels(
  diagramSets: readonly Pick<DiagramSetRecord, "id" | "name">[]
): Array<{ diagramSetId: string; label: string; name: string }> {
  const normalized = diagramSets.map((set) => ({
    set,
    value: set.name.toUpperCase().replace(/[^A-Z0-9]/g, "") || "SET"
  }));
  return normalized.map(({ set, value }) => {
    let label = value;
    for (let length = 1; length <= value.length; length += 1) {
      const candidate = value.slice(0, length);
      if (normalized.every((other) => (
        other.set.id === set.id || !other.value.startsWith(candidate)
      ))) {
        label = candidate;
        break;
      }
    }
    return { diagramSetId: set.id, label, name: set.name };
  });
}

/** Build one file index from exact mappings across every local DiagramSet. */
export function diagramSetFileIndex(input: {
  projectId: string;
  diagramSets: readonly DiagramSetRecord[];
  diagrams: Readonly<Record<string, DiagramRecord>>;
  codeEntitySets: Readonly<Record<string, CodeEntitiesSetRecord>>;
  codeEntityMaps: Readonly<Record<string, DiagramCodeEntityMapRecord>>;
}): DiagramSetFileIndex {
  const labels = diagramSetFileLabels(input.diagramSets);
  const labelBySetId = new Map(labels.map((label) => [label.diagramSetId, label.label]));
  const labelsByPath = new Map<string, Set<string>>();
  const entitiesByPath = new Map<string, DiagramSetFileEntityReference[]>();
  const unresolvedEntityIds = new Set<string>();
  const foreignEntityIds = new Set<string>();
  const invalidPaths = new Set<string>();

  for (const diagramSet of input.diagramSets) {
    const label = labelBySetId.get(diagramSet.id);
    const entitySet = input.codeEntitySets[diagramSet.codeEntitiesSetId];
    if (!label || !entitySet) continue;
    const entitiesById = new Map(entitySet.entities.map((entity) => [entity.id, entity]));
    for (const diagramId of diagramSet.diagramIds) {
      const diagram = input.diagrams[diagramId];
      if (!diagram || diagram.archivedAt) continue;
      const entityMap = input.codeEntityMaps[`${diagramSet.id}:${diagramId}`]
        ?? input.codeEntityMaps[diagramId];
      if (!entityMap || entityMap.diagramSetId !== diagramSet.id) continue;
      for (const mapping of entityMap.mappings) {
        const entity = entitiesById.get(mapping.entityId);
        if (!entity) {
          unresolvedEntityIds.add(mapping.entityId);
          continue;
        }
        if (entity.origin && entity.origin.projectId !== input.projectId) {
          foreignEntityIds.add(entity.id);
          continue;
        }
        const identifiedRangeIndex = mapping.sourceRangeId
          ? entity.sourceRanges.findIndex((range) => range.id === mapping.sourceRangeId)
          : -1;
        const sourceRangeIndex = identifiedRangeIndex >= 0
          ? identifiedRangeIndex
          : mapping.sourceRangeIndex;
        const range = entity.sourceRanges[sourceRangeIndex];
        if (!range) {
          unresolvedEntityIds.add(entity.id);
          continue;
        }
        const repositoryPath = normalizeRepositoryPath(range.path);
        if (!repositoryPath) {
          invalidPaths.add(range.path);
          continue;
        }
        const pathLabels = labelsByPath.get(repositoryPath) ?? new Set<string>();
        pathLabels.add(label);
        labelsByPath.set(repositoryPath, pathLabels);
        const references = entitiesByPath.get(repositoryPath) ?? [];
        if (!references.some((reference) => (
          reference.diagramSetId === diagramSet.id
          && reference.entityId === entity.id
          && reference.sourceRangeIndex === sourceRangeIndex
        ))) {
          references.push({
            diagramSetId: diagramSet.id,
            diagramId,
            entityId: entity.id,
            handle: entity.handle,
            label: entity.label,
            sourceRangeIndex
          });
          entitiesByPath.set(repositoryPath, references);
        }
      }
    }
  }

  const labelOrder = new Map(labels.map(({ label }, index) => [label, index]));
  const sortLabels = (values: Iterable<string>) => [...values].sort(
    (left, right) => (labelOrder.get(left) ?? 0) - (labelOrder.get(right) ?? 0)
  );
  return {
    paths: [...labelsByPath.keys()].sort((left, right) => left.localeCompare(right)),
    labels,
    labelsByPath: Object.fromEntries(
      [...labelsByPath.entries()].map(([filePath, values]) => [filePath, sortLabels(values)])
    ),
    entitiesByPath: Object.fromEntries(
      [...entitiesByPath.entries()].sort(([left], [right]) => left.localeCompare(right))
    ),
    unresolvedEntityIds: [...unresolvedEntityIds],
    foreignEntityIds: [...foreignEntityIds],
    invalidPaths: [...invalidPaths]
  };
}

/** Roll direct file labels up to every ancestor directory in the displayed tree. */
export function rollUpFileTreeLabels(
  filePaths: readonly string[],
  labelsByFilePath: Readonly<Record<string, readonly string[]>>,
  orderedLabels: readonly string[]
): Record<string, string[]> {
  const labelsByNode = new Map<string, Set<string>>();
  for (const filePath of filePaths) {
    const labels = labelsByFilePath[filePath] ?? [];
    const segments = filePath.split("/");
    let nodePath = "";
    for (const segment of segments) {
      nodePath = nodePath ? `${nodePath}/${segment}` : segment;
      const nodeLabels = labelsByNode.get(nodePath) ?? new Set<string>();
      for (const label of labels) nodeLabels.add(label);
      labelsByNode.set(nodePath, nodeLabels);
    }
  }
  const order = new Map(orderedLabels.map((label, index) => [label, index]));
  return Object.fromEntries([...labelsByNode.entries()].map(([nodePath, labels]) => [
    nodePath,
    [...labels].sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0))
  ]));
}

export function parentRepositoryPath(filePath: string): string {
  const index = filePath.lastIndexOf("/");
  return index < 0 ? "" : filePath.slice(0, index);
}

export function buildFileTree(paths: readonly string[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];
  for (const rawPath of paths) {
    const filePath = normalizeRepositoryPath(rawPath);
    if (!filePath) continue;
    const segments = filePath.split("/");
    let children = root;
    let currentPath = "";
    for (const [index, name] of segments.entries()) {
      currentPath = currentPath ? `${currentPath}/${name}` : name;
      const kind = index === segments.length - 1 ? "file" : "directory";
      let node = children.find((candidate) => candidate.path === currentPath);
      if (!node) {
        node = { path: currentPath, name, kind, children: [] };
        children.push(node);
      }
      children = node.children;
    }
  }
  const sort = (nodes: FileTreeNode[]) => {
    nodes.sort(compareRepositoryEntries);
    for (const node of nodes) sort(node.children);
  };
  sort(root);
  return root;
}

export function directoryPaths(nodes: readonly FileTreeNode[]): string[] {
  return nodes.flatMap((node) => node.kind === "directory"
    ? [node.path, ...directoryPaths(node.children)]
    : []);
}

export function flattenFileTree(
  nodes: readonly FileTreeNode[],
  expandedPaths: ReadonlySet<string>
): FileTreeRow[] {
  const rows: FileTreeRow[] = [];
  const visit = (
    siblings: readonly FileTreeNode[],
    level: number,
    parentPath: string,
    ancestorLast: readonly boolean[]
  ) => {
    siblings.forEach((node, index) => {
      const last = index === siblings.length - 1;
      const prefix = level === 1
        ? ""
        : `${ancestorLast.slice(0, -1).map((ancestorWasLast) => (
          ancestorWasLast ? "    " : "|   "
        )).join("")}${last ? "`-- " : "+-- "}`;
      rows.push({
        path: node.path,
        name: node.name,
        kind: node.kind,
        level,
        parentPath,
        prefix
      });
      if (node.kind === "directory" && expandedPaths.has(node.path)) {
        visit(node.children, level + 1, node.path, [...ancestorLast, last]);
      }
    });
  };
  visit(nodes, 1, "", []);
  return rows;
}

export function flattenRepositoryListings(
  rootEntries: readonly RepositoryEntry[],
  listings: Readonly<Record<string, RepositoryDirectoryListing>>,
  expandedPaths: ReadonlySet<string>
): FileTreeRow[] {
  const rows: FileTreeRow[] = [];
  const visit = (
    siblings: readonly RepositoryEntry[],
    level: number,
    parentPath: string,
    ancestorLast: readonly boolean[]
  ) => {
    const sorted = [...siblings].sort(compareRepositoryEntries);
    sorted.forEach((entry, index) => {
      const last = index === sorted.length - 1;
      const prefix = level === 1
        ? ""
        : `${ancestorLast.slice(0, -1).map((ancestorWasLast) => (
          ancestorWasLast ? "    " : "|   "
        )).join("")}${last ? "`-- " : "+-- "}`;
      rows.push({ ...entry, level, parentPath, prefix });
      if (entry.kind === "directory" && expandedPaths.has(entry.path)) {
        visit(listings[entry.path]?.entries ?? [], level + 1, entry.path, [...ancestorLast, last]);
      }
    });
  };
  visit(rootEntries, 1, "", []);
  return rows;
}
