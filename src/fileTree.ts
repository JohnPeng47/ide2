import type {
  CodeEntityRecord,
  DiagramComponentRecord,
  DiagramRecord,
  RepositoryDirectoryListing,
  RepositoryEntry
} from "./domain";

export interface DiagramFileFilter {
  paths: string[];
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
    for (const range of entity.sourceRanges) {
      const path = normalizeRepositoryPath(range.path);
      if (path) paths.add(path);
      else invalidPaths.push(range.path);
    }
  }
  return {
    paths: [...paths].sort((left, right) => left.localeCompare(right)),
    unresolvedEntityIds,
    foreignEntityIds,
    invalidPaths
  };
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
