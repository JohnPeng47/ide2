import type {
  DiagramRepresentationIndex,
  RepresentationIndex,
  RepresentationRevision,
  TreeRepresentationIndex
} from "../representations/representationIndex";
import {
  isRepresentationRevisionCurrent,
  resolveEvidenceElements,
  treeRepresentationLineage,
  treeRepresentationSubtree
} from "../representations/representationIndex";

export type RepresentationKind = RepresentationIndex["kind"];

export type AgentWorkTarget =
  | { kind: "artifact" }
  | { kind: "tree-node"; elementId: string }
  | { kind: "tree-subtree"; elementId: string }
  | { kind: "diagram-element"; elementId: string }
  | { kind: "evidence"; evidenceId: string };

interface AgentWorkScopeBase {
  /** The immutable artifact revision against which element identities were issued. */
  revision: RepresentationRevision;
  /** Explicit even when the target itself (for example, evidence) is domain-neutral. */
  representationKind: RepresentationKind;
}

export type AgentWorkScope =
  | (AgentWorkScopeBase & {
      representationKind: RepresentationKind;
      target: { kind: "artifact" };
    })
  | (AgentWorkScopeBase & {
      representationKind: "tree";
      target: { kind: "tree-node" | "tree-subtree"; elementId: string };
    })
  | (AgentWorkScopeBase & {
      representationKind: "diagram";
      target: { kind: "diagram-element"; elementId: string };
    })
  | (AgentWorkScopeBase & {
      representationKind: RepresentationKind;
      target: { kind: "evidence"; evidenceId: string };
    });

export type AgentWorkScopeValidationCode =
  | "stale-revision"
  | "representation-kind-mismatch"
  | "target-kind-mismatch"
  | "element-not-found"
  | "evidence-not-found";

export type AgentWorkScopeValidation =
  | { valid: true }
  | { valid: false; code: AgentWorkScopeValidationCode; message: string };

export class AgentWorkScopeError extends Error {
  constructor(
    readonly code: AgentWorkScopeValidationCode,
    message: string
  ) {
    super(message);
    this.name = "AgentWorkScopeError";
  }
}

export interface TreeStructuralLocation {
  representationKind: "tree";
  elementId: string;
  parentId?: string;
  childIds: string[];
  lineageElementIds: string[];
}

export interface DiagramGridLocation {
  representationKind: "diagram";
  elementId: string;
  line: number;
  startColumn: number;
  endColumn: number;
}

export type RepresentationElementLocation = TreeStructuralLocation | DiagramGridLocation;

export interface ResolvedAgentWorkScope {
  scope: AgentWorkScope;
  /** Stable representation order: tree pre-order or diagram row/column order. */
  elementIds: string[];
  locations: RepresentationElementLocation[];
}

function invalid(
  code: AgentWorkScopeValidationCode,
  message: string
): AgentWorkScopeValidation {
  return { valid: false, code, message };
}

function elementExists(index: RepresentationIndex, elementId: string): boolean {
  return index.kind === "tree"
    ? index.nodes[elementId] !== undefined
    : index.elements[elementId] !== undefined;
}

/** Validate a scope before resolving it against a representation index. */
export function validateAgentWorkScope(
  scope: AgentWorkScope,
  index: RepresentationIndex
): AgentWorkScopeValidation {
  if (!isRepresentationRevisionCurrent(index.revision, scope.revision)) {
    return invalid(
      "stale-revision",
      `scope revision ${scope.revision.artifactId}@${scope.revision.asciiSha256} does not match `
        + `${index.revision.artifactId}@${index.revision.asciiSha256}`
    );
  }
  if (scope.representationKind !== index.kind) {
    return invalid(
      "representation-kind-mismatch",
      `scope requires a ${scope.representationKind} representation, received ${index.kind}`
    );
  }
  if ((scope.target.kind === "tree-node" || scope.target.kind === "tree-subtree")
    && index.kind !== "tree") {
    return invalid("target-kind-mismatch", `${scope.target.kind} requires a tree representation`);
  }
  if (scope.target.kind === "diagram-element" && index.kind !== "diagram") {
    return invalid("target-kind-mismatch", "diagram-element requires a diagram representation");
  }
  if (scope.target.kind === "tree-node"
    || scope.target.kind === "tree-subtree"
    || scope.target.kind === "diagram-element") {
    if (!elementExists(index, scope.target.elementId)) {
      return invalid(
        "element-not-found",
        `representation element not found: ${scope.target.elementId}`
      );
    }
  }
  if (scope.target.kind === "evidence"
    && resolveEvidenceElements(index, scope.target.evidenceId).length === 0) {
    return invalid("evidence-not-found", `evidence not found: ${scope.target.evidenceId}`);
  }
  return { valid: true };
}

export function assertAgentWorkScope(
  scope: AgentWorkScope,
  index: RepresentationIndex
): void {
  const validation = validateAgentWorkScope(scope, index);
  if (!validation.valid) throw new AgentWorkScopeError(validation.code, validation.message);
}

function orderedTreeElementIds(index: TreeRepresentationIndex): string[] {
  return Object.values(index.nodes)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .map((node) => node.id);
}

function orderedDiagramElementIds(index: DiagramRepresentationIndex): string[] {
  return Object.values(index.elements)
    .sort((left, right) => left.line - right.line
      || left.startColumn - right.startColumn
      || left.endColumn - right.endColumn
      || left.id.localeCompare(right.id))
    .map((element) => element.id);
}

export function representationElementIds(index: RepresentationIndex): string[] {
  return index.kind === "tree"
    ? orderedTreeElementIds(index)
    : orderedDiagramElementIds(index);
}

function locationsForIds(
  index: RepresentationIndex,
  elementIds: readonly string[]
): RepresentationElementLocation[] {
  if (index.kind === "tree") {
    return elementIds.map((elementId) => {
      const node = index.nodes[elementId];
      return {
        representationKind: "tree" as const,
        elementId,
        ...(node.parentId ? { parentId: node.parentId } : {}),
        childIds: [...node.childIds],
        lineageElementIds: treeRepresentationLineage(index, elementId).map((ancestor) => ancestor.id)
      };
    });
  }
  return elementIds.map((elementId) => {
    const element = index.elements[elementId];
    return {
      representationKind: "diagram" as const,
      elementId,
      line: element.line,
      startColumn: element.startColumn,
      endColumn: element.endColumn
    };
  });
}

/** Resolve an ID-only scope into structural tree locations or diagram grid bounds. */
export function resolveAgentWorkScope(
  scope: AgentWorkScope,
  index: RepresentationIndex
): ResolvedAgentWorkScope {
  assertAgentWorkScope(scope, index);
  let elementIds: string[];
  switch (scope.target.kind) {
    case "artifact":
      elementIds = representationElementIds(index);
      break;
    case "tree-node":
    case "diagram-element":
      elementIds = [scope.target.elementId];
      break;
    case "tree-subtree":
      if (index.kind !== "tree") {
        // assertAgentWorkScope catches invalid untyped input; this keeps narrowing explicit.
        throw new AgentWorkScopeError("target-kind-mismatch", "tree-subtree requires a tree representation");
      }
      elementIds = treeRepresentationSubtree(index, scope.target.elementId).map((node) => node.id);
      break;
    case "evidence": {
      const matches = new Set(
        resolveEvidenceElements(index, scope.target.evidenceId).map((match) => match.elementId)
      );
      elementIds = representationElementIds(index).filter((elementId) => matches.has(elementId));
      break;
    }
  }
  return {
    scope,
    elementIds,
    locations: locationsForIds(index, elementIds)
  };
}

export type SpatialProgressStatus = "queued" | "running" | "complete" | "failed";

export interface SpatialProgressState {
  scope: AgentWorkScope;
  status: SpatialProgressStatus;
  currentElementIds: string[];
  visitedElementIds: string[];
  completedElementIds: string[];
  error?: string;
}

export interface SpatialProgressUpdate {
  status?: SpatialProgressStatus;
  /** Replaces the current frontier. Omit to retain it while running. */
  currentElementIds?: readonly string[];
  /** Monotonically accumulated with previously visited elements. */
  visitedElementIds?: readonly string[];
  /** Monotonically accumulated with previously completed elements. */
  completedElementIds?: readonly string[];
  /** Set only for failed work; null explicitly clears a prior message. */
  error?: string | null;
}

export type SpatialProgressValidationCode =
  | AgentWorkScopeValidationCode
  | "element-outside-scope"
  | "duplicate-element"
  | "current-not-visited"
  | "completed-not-visited"
  | "current-already-completed"
  | "inactive-current-elements"
  | "unexpected-error";

export type SpatialProgressValidation =
  | { valid: true }
  | { valid: false; code: SpatialProgressValidationCode; message: string };

export class SpatialProgressError extends Error {
  constructor(
    readonly code: SpatialProgressValidationCode,
    message: string
  ) {
    super(message);
    this.name = "SpatialProgressError";
  }
}

function sameScope(left: AgentWorkScope, right: AgentWorkScope): boolean {
  if (left.representationKind !== right.representationKind
    || left.revision.artifactId !== right.revision.artifactId
    || left.revision.asciiSha256 !== right.revision.asciiSha256
    || left.target.kind !== right.target.kind) return false;
  if (left.target.kind === "artifact" && right.target.kind === "artifact") return true;
  if (left.target.kind === "evidence" && right.target.kind === "evidence") {
    return left.target.evidenceId === right.target.evidenceId;
  }
  return "elementId" in left.target
    && "elementId" in right.target
    && left.target.elementId === right.target.elementId;
}

function duplicates(values: readonly string[]): string | undefined {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return undefined;
}

export function validateSpatialProgressState(
  state: SpatialProgressState,
  index: RepresentationIndex
): SpatialProgressValidation {
  const scopeValidation = validateAgentWorkScope(state.scope, index);
  if (!scopeValidation.valid) return scopeValidation;
  const allowed = new Set(resolveAgentWorkScope(state.scope, index).elementIds);
  const groups = [
    ["current", state.currentElementIds],
    ["visited", state.visitedElementIds],
    ["completed", state.completedElementIds]
  ] as const;
  for (const [label, values] of groups) {
    const duplicate = duplicates(values);
    if (duplicate) {
      return {
        valid: false,
        code: "duplicate-element",
        message: `${label} contains duplicate element: ${duplicate}`
      };
    }
    const outside = values.find((elementId) => !allowed.has(elementId));
    if (outside) {
      return {
        valid: false,
        code: "element-outside-scope",
        message: `${label} element is outside the work scope: ${outside}`
      };
    }
  }
  const visited = new Set(state.visitedElementIds);
  const completed = new Set(state.completedElementIds);
  const currentNotVisited = state.currentElementIds.find((elementId) => !visited.has(elementId));
  if (currentNotVisited) {
    return {
      valid: false,
      code: "current-not-visited",
      message: `current element has not been visited: ${currentNotVisited}`
    };
  }
  const completedNotVisited = state.completedElementIds.find((elementId) => !visited.has(elementId));
  if (completedNotVisited) {
    return {
      valid: false,
      code: "completed-not-visited",
      message: `completed element has not been visited: ${completedNotVisited}`
    };
  }
  const currentCompleted = state.currentElementIds.find((elementId) => completed.has(elementId));
  if (currentCompleted) {
    return {
      valid: false,
      code: "current-already-completed",
      message: `completed element cannot remain current: ${currentCompleted}`
    };
  }
  if (state.status !== "running" && state.currentElementIds.length > 0) {
    return {
      valid: false,
      code: "inactive-current-elements",
      message: `${state.status} progress cannot have current elements`
    };
  }
  if (state.status !== "failed" && state.error !== undefined) {
    return {
      valid: false,
      code: "unexpected-error",
      message: `${state.status} progress cannot have an error`
    };
  }
  return { valid: true };
}

export function assertSpatialProgressState(
  state: SpatialProgressState,
  index: RepresentationIndex
): void {
  const validation = validateSpatialProgressState(state, index);
  if (!validation.valid) throw new SpatialProgressError(validation.code, validation.message);
}

function sortWithinScope(
  elementIds: Iterable<string>,
  resolved: ResolvedAgentWorkScope
): string[] {
  const included = new Set(elementIds);
  return resolved.elementIds.filter((elementId) => included.has(elementId));
}

function assertElementIdsAllowed(
  elementIds: readonly string[],
  resolved: ResolvedAgentWorkScope
): void {
  const allowed = new Set(resolved.elementIds);
  const outside = elementIds.find((elementId) => !allowed.has(elementId));
  if (outside) {
    throw new SpatialProgressError(
      "element-outside-scope",
      `progress element is outside the work scope: ${outside}`
    );
  }
}

export function createSpatialProgressState(
  scope: AgentWorkScope,
  index: RepresentationIndex
): SpatialProgressState {
  assertAgentWorkScope(scope, index);
  return {
    scope,
    status: "queued",
    currentElementIds: [],
    visitedElementIds: [],
    completedElementIds: []
  };
}

const statusOrder: Record<SpatialProgressStatus, number> = {
  queued: 0,
  running: 1,
  failed: 2,
  complete: 3
};

/**
 * Apply one progress event. Element sets are normalized to representation order;
 * visited and completed sets are monotonic, while the current frontier is replaceable.
 */
export function updateSpatialProgressState(
  state: SpatialProgressState,
  update: SpatialProgressUpdate,
  index: RepresentationIndex
): SpatialProgressState {
  assertSpatialProgressState(state, index);
  const resolved = resolveAgentWorkScope(state.scope, index);
  const additions = [
    ...(update.currentElementIds ?? []),
    ...(update.visitedElementIds ?? []),
    ...(update.completedElementIds ?? [])
  ];
  assertElementIdsAllowed(additions, resolved);

  const status = update.status ?? state.status;
  if (statusOrder[status] < statusOrder[state.status]) {
    throw new SpatialProgressError(
      "inactive-current-elements",
      `progress status cannot move backward from ${state.status} to ${status}`
    );
  }
  const completed = new Set([...state.completedElementIds, ...(update.completedElementIds ?? [])]);
  const requestedCurrent = update.currentElementIds ?? state.currentElementIds;
  const current = status === "running"
    ? requestedCurrent.filter((elementId) => !completed.has(elementId))
    : [];
  const visited = new Set([
    ...state.visitedElementIds,
    ...(update.visitedElementIds ?? []),
    ...requestedCurrent,
    ...completed
  ]);
  const error = status === "failed"
    ? (update.error === null ? undefined : update.error ?? state.error)
    : undefined;
  const next: SpatialProgressState = {
    scope: state.scope,
    status,
    currentElementIds: sortWithinScope(current, resolved),
    visitedElementIds: sortWithinScope(visited, resolved),
    completedElementIds: sortWithinScope(completed, resolved),
    ...(error !== undefined ? { error } : {})
  };
  assertSpatialProgressState(next, index);
  return next;
}

/**
 * Convergent merge for progress snapshots of the same scope. Set fields use union,
 * status uses a fixed lattice (complete > failed > running > queued), and error
 * ties use lexical order, making the result commutative, associative and idempotent.
 */
export function mergeSpatialProgressStates(
  states: readonly SpatialProgressState[],
  index: RepresentationIndex
): SpatialProgressState {
  if (states.length === 0) throw new Error("at least one spatial progress state is required");
  for (const state of states) assertSpatialProgressState(state, index);
  const scope = states[0].scope;
  if (states.some((state) => !sameScope(scope, state.scope))) {
    throw new Error("cannot merge spatial progress for different scopes");
  }
  const resolved = resolveAgentWorkScope(scope, index);
  const status = states
    .map((state) => state.status)
    .sort((left, right) => statusOrder[right] - statusOrder[left])[0];
  const completed = new Set(states.flatMap((state) => state.completedElementIds));
  const visited = new Set(states.flatMap((state) => [
    ...state.visitedElementIds,
    ...state.currentElementIds,
    ...state.completedElementIds
  ]));
  const current = status === "running"
    ? new Set(states.flatMap((state) => state.currentElementIds)
      .filter((elementId) => !completed.has(elementId)))
    : new Set<string>();
  const errors = states
    .map((state) => state.error)
    .filter((error): error is string => error !== undefined)
    .sort((left, right) => left.localeCompare(right));
  const merged: SpatialProgressState = {
    scope,
    status,
    currentElementIds: sortWithinScope(current, resolved),
    visitedElementIds: sortWithinScope(visited, resolved),
    completedElementIds: sortWithinScope(completed, resolved),
    ...(status === "failed" && errors[0] !== undefined ? { error: errors[0] } : {})
  };
  assertSpatialProgressState(merged, index);
  return merged;
}
