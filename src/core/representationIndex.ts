import { parseAsciiTree } from "./asciiTree";
import type { DiagramCodeEntityMapRecord, DiagramElementMapping } from "./domain";

export interface RepresentationRevision {
  artifactId: string;
  asciiSha256: string;
}

export interface EvidenceElementLink {
  evidenceId: string;
  sourceRangeId?: string;
  sourceRangeIndex: number;
}

export interface TreeRepresentationNode {
  id: string;
  /** Zero-based pre-order within this artifact revision. */
  order: number;
  line: number;
  text: string;
  rootId: string;
  parentId?: string;
  childIds: string[];
  mappingIds: string[];
  evidence: EvidenceElementLink[];
}

export interface TreeRepresentationIndex {
  kind: "tree";
  revision: RepresentationRevision;
  rootIds: string[];
  nodes: Record<string, TreeRepresentationNode>;
}

export interface DiagramRepresentationElement {
  id: string;
  mappingId: string;
  line: number;
  startColumn: number;
  endColumn: number;
  evidence: EvidenceElementLink[];
}

export interface DiagramRepresentationIndex {
  kind: "diagram";
  revision: RepresentationRevision;
  elements: Record<string, DiagramRepresentationElement>;
}

export type RepresentationIndex = TreeRepresentationIndex | DiagramRepresentationIndex;

export interface ResolvedEvidenceElement {
  representationKind: RepresentationIndex["kind"];
  elementId: string;
  evidence: EvidenceElementLink;
}

export interface SpatialEvidenceResolver {
  resolveEvidence(index: RepresentationIndex, evidenceId: string): ResolvedEvidenceElement[];
  resolveElement(index: RepresentationIndex, elementId: string): ResolvedEvidenceElement[];
}

export interface RepresentationIndexSource {
  revision: RepresentationRevision;
  ascii: string;
  codeEntityMap?: DiagramCodeEntityMapRecord;
}

export type RepresentationIndexRequest = RepresentationIndexSource & (
  | { kind: "tree" }
  | { kind: "diagram" }
);

function revisionScope(revision: RepresentationRevision): string {
  return `${encodeURIComponent(revision.artifactId)}@${revision.asciiSha256}`;
}

function evidenceForMapping(mapping: DiagramElementMapping): EvidenceElementLink {
  return {
    evidenceId: mapping.entityId,
    ...(mapping.sourceRangeId !== undefined ? { sourceRangeId: mapping.sourceRangeId } : {}),
    sourceRangeIndex: mapping.sourceRangeIndex
  };
}

function mappingsInVisualOrder(
  mappings: readonly DiagramElementMapping[]
): DiagramElementMapping[] {
  return [...mappings].sort((left, right) => (
    left.line - right.line
    || left.startColumn - right.startColumn
    || left.endColumn - right.endColumn
    || left.id.localeCompare(right.id)
  ));
}

/** Fail before building or using an index for a different artifact revision. */
export function assertRepresentationRevision(
  actual: RepresentationRevision,
  expected: RepresentationRevision
): void {
  if (actual.artifactId !== expected.artifactId) {
    throw new Error(
      `stale representation artifact: expected ${expected.artifactId}, received ${actual.artifactId}`
    );
  }
  if (actual.asciiSha256 !== expected.asciiSha256) {
    throw new Error(
      `stale representation ASCII for artifact ${expected.artifactId}: SHA-256 does not match`
    );
  }
}

export function isRepresentationRevisionCurrent(
  actual: RepresentationRevision,
  expected: RepresentationRevision
): boolean {
  return actual.artifactId === expected.artifactId
    && actual.asciiSha256 === expected.asciiSha256;
}

function assertCurrentMap(
  revision: RepresentationRevision,
  codeEntityMap?: DiagramCodeEntityMapRecord
): void {
  if (!codeEntityMap) return;
  assertRepresentationRevision(
    { artifactId: codeEntityMap.artifactId, asciiSha256: codeEntityMap.asciiSha256 },
    revision
  );
}

/**
 * Build the structural index for indentation-based ASCII trees. Node identity is
 * an ancestry path scoped to an artifact revision, never a rendered coordinate.
 */
export function buildTreeRepresentationIndex(
  request: RepresentationIndexSource
): TreeRepresentationIndex {
  assertCurrentMap(request.revision, request.codeEntityMap);
  const parsed = parseAsciiTree(request.ascii);
  const scope = revisionScope(request.revision);
  const idByLine = new Map<number, string>();
  const pathByLine = new Map<number, string>();
  const nextChildOrder = new Map<number | undefined, number>();
  const nodes: Record<string, TreeRepresentationNode> = {};
  const rootIds: string[] = [];
  const mappings = mappingsInVisualOrder(request.codeEntityMap?.mappings ?? []);

  for (const [order, parsedNode] of parsed.entries()) {
    const siblingOrder = nextChildOrder.get(parsedNode.parentLine) ?? 0;
    nextChildOrder.set(parsedNode.parentLine, siblingOrder + 1);
    const parentPath = parsedNode.parentLine === undefined
      ? undefined
      : pathByLine.get(parsedNode.parentLine);
    const path = parentPath === undefined ? `${siblingOrder}` : `${parentPath}.${siblingOrder}`;
    const id = `tree:${scope}:${path}`;
    const parentId = parsedNode.parentLine === undefined
      ? undefined
      : idByLine.get(parsedNode.parentLine);
    const rootId = parentId ? nodes[parentId].rootId : id;
    const textEndColumn = parsedNode.textColumn + parsedNode.text.length - 1;
    const evidence = mappings
      .filter((mapping) => mapping.line === parsedNode.line
        && mapping.startColumn <= textEndColumn
        && mapping.endColumn >= parsedNode.textColumn)
      .map(evidenceForMapping);
    nodes[id] = {
      id,
      order,
      line: parsedNode.line,
      text: parsedNode.text,
      rootId,
      ...(parentId ? { parentId } : {}),
      childIds: [],
      mappingIds: mappings
        .filter((mapping) => mapping.line === parsedNode.line
          && mapping.startColumn <= textEndColumn
          && mapping.endColumn >= parsedNode.textColumn)
        .map((mapping) => mapping.id),
      evidence
    };
    idByLine.set(parsedNode.line, id);
    pathByLine.set(parsedNode.line, path);
    if (parentId) nodes[parentId].childIds.push(id);
    else rootIds.push(id);
  }

  // Tree renderings can carry semantic root headings, legends, or annotations
  // outside the branch grammar. Index those structural text lines as standalone
  // roots so every valid visible mapping remains bidirectionally resolvable.
  const parsedLines = new Set(parsed.map((node) => node.line));
  const assignedMappingIds = new Set(Object.values(nodes).flatMap((node) => node.mappingIds));
  const lines = request.ascii.replace(/\r\n?/g, "\n").split("\n");
  let looseOrder = 0;
  for (const [lineIndex, line] of lines.entries()) {
    const lineNumber = lineIndex + 1;
    if (!line.trim()) continue;
    const lineMappings = mappings.filter((mapping) => mapping.line === lineNumber
      && !assignedMappingIds.has(mapping.id));
    if (parsedLines.has(lineNumber) && lineMappings.length === 0) continue;
    const semanticText = /[A-Za-z0-9]/.test(line);
    if (!semanticText && lineMappings.length === 0) continue;
    const id = `tree:${scope}:loose.${looseOrder++}`;
    nodes[id] = {
      id,
      order: parsed.length + looseOrder - 1,
      line: lineNumber,
      text: line.trim(),
      rootId: id,
      childIds: [],
      mappingIds: lineMappings.map((mapping) => mapping.id),
      evidence: lineMappings.map(evidenceForMapping)
    };
    rootIds.push(id);
  }

  const orderedNodes = Object.fromEntries(Object.values(nodes)
    .sort((left, right) => left.line - right.line || left.order - right.order)
    .map((node, order) => [node.id, { ...node, order }]));
  rootIds.sort((left, right) => orderedNodes[left].order - orderedNodes[right].order);

  return { kind: "tree", revision: { ...request.revision }, rootIds, nodes: orderedNodes };
}

/** Build one exact, inclusive diagram element for every persisted mapping. */
export function buildDiagramRepresentationIndex(
  request: RepresentationIndexSource
): DiagramRepresentationIndex {
  assertCurrentMap(request.revision, request.codeEntityMap);
  const scope = revisionScope(request.revision);
  const elements: Record<string, DiagramRepresentationElement> = {};
  const mappings = mappingsInVisualOrder(request.codeEntityMap?.mappings ?? []);
  for (const mapping of mappings) {
    const id = `diagram:${scope}:${encodeURIComponent(mapping.id)}`;
    if (elements[id]) throw new Error(`duplicate diagram mapping id: ${mapping.id}`);
    elements[id] = {
      id,
      mappingId: mapping.id,
      line: mapping.line,
      startColumn: mapping.startColumn,
      endColumn: mapping.endColumn,
      evidence: [evidenceForMapping(mapping)]
    };
  }
  return { kind: "diagram", revision: { ...request.revision }, elements };
}

/** Build the explicitly requested representation; callers own kind selection. */
export function buildRepresentationIndex(request: RepresentationIndexRequest): RepresentationIndex {
  return request.kind === "tree"
    ? buildTreeRepresentationIndex(request)
    : buildDiagramRepresentationIndex(request);
}

/** Return a tree node's root-to-node ancestry, or an empty list for an unknown id. */
export function treeRepresentationLineage(
  index: TreeRepresentationIndex,
  nodeId: string
): TreeRepresentationNode[] {
  const lineage: TreeRepresentationNode[] = [];
  const visited = new Set<string>();
  let node: TreeRepresentationNode | undefined = index.nodes[nodeId];
  while (node && !visited.has(node.id)) {
    visited.add(node.id);
    lineage.unshift(node);
    node = node.parentId ? index.nodes[node.parentId] : undefined;
  }
  return lineage;
}

/** Return a tree node and its descendants in stable pre-order. */
export function treeRepresentationSubtree(
  index: TreeRepresentationIndex,
  nodeId: string
): TreeRepresentationNode[] {
  if (!index.nodes[nodeId]) return [];
  const result: TreeRepresentationNode[] = [];
  const visit = (id: string): void => {
    const node = index.nodes[id];
    if (!node) return;
    result.push(node);
    for (const childId of node.childIds) visit(childId);
  };
  visit(nodeId);
  return result;
}

function elementsOf(index: RepresentationIndex): Record<string, {
  id: string;
  evidence: EvidenceElementLink[];
}> {
  return index.kind === "tree" ? index.nodes : index.elements;
}

/** Stateless bidirectional resolver shared by tree and free-form diagram indexes. */
export const spatialEvidenceResolver: SpatialEvidenceResolver = {
  resolveEvidence(index, evidenceId) {
    return Object.values(elementsOf(index)).flatMap((element) => (
      element.evidence
        .filter((evidence) => evidence.evidenceId === evidenceId)
        .map((evidence) => ({ representationKind: index.kind, elementId: element.id, evidence }))
    ));
  },
  resolveElement(index, elementId) {
    const element = elementsOf(index)[elementId];
    if (!element) return [];
    return element.evidence.map((evidence) => ({
      representationKind: index.kind,
      elementId,
      evidence
    }));
  }
};

export function resolveEvidenceElements(
  index: RepresentationIndex,
  evidenceId: string
): ResolvedEvidenceElement[] {
  return spatialEvidenceResolver.resolveEvidence(index, evidenceId);
}

export function resolveElementEvidence(
  index: RepresentationIndex,
  elementId: string
): ResolvedEvidenceElement[] {
  return spatialEvidenceResolver.resolveElement(index, elementId);
}

/** Renderer lookup from a persisted mapping identity to its stable element identity. */
export function representationElementIdForMapping(
  index: RepresentationIndex,
  mappingId: string
): string | undefined {
  const elements = index.kind === "tree" ? index.nodes : index.elements;
  return Object.values(elements).find((element) => index.kind === "tree"
    ? (element as TreeRepresentationNode).mappingIds.includes(mappingId)
    : (element as DiagramRepresentationElement).mappingId === mappingId)?.id;
}
