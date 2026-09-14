export type RepresentationKind = "tree" | "diagram";

export interface RepresentationArtifactRevision {
  artifactId: string;
  asciiSha256: string;
  /** Optional for records written before artifact revision numbers were exposed. */
  revision?: number;
  artifactKind?: string;
}

export interface RepresentationEvidenceReference {
  evidenceId: string;
  sourceRangeId?: string;
  /** Legacy range address; new records should prefer sourceRangeId. */
  sourceRangeIndex?: number;
  /** Stable structural/spatial id from a RepresentationIndex. */
  elementId?: string;
}

export interface RepresentationRecipeRevisionReference {
  recipeId: string;
  revision: number;
}

export interface RepresentationLayerRecord {
  id: string;
  label: string;
  /** Lower ranks are more abstract; documents resolved through evidence are terminal. */
  informationRank: number;
  representationKind: RepresentationKind;
  artifactRevision: RepresentationArtifactRevision;
  evidenceReferences?: RepresentationEvidenceReference[];
  recipe?: RepresentationRecipeRevisionReference;
  createdAt?: string;
}

export interface RepresentationTransitionRecord {
  id: string;
  fromLayerId: string;
  toLayerId: string;
  evidenceReferences?: RepresentationEvidenceReference[];
  recipe?: RepresentationRecipeRevisionReference;
  createdAt?: string;
}

export type RepresentationFeedbackTarget =
  | { kind: "layer"; layerId: string }
  | { kind: "transition"; transitionId: string };

export interface RepresentationFeedbackRecord {
  id: string;
  target: RepresentationFeedbackTarget;
  comment: string;
  createdAt: string;
}

export interface RepresentationRecipe {
  id: string;
  revision: number;
  target: RepresentationFeedbackTarget;
  instruction: string;
  supersedesRevision?: number;
  incorporatedFeedbackIds: string[];
  createdAt: string;
}

export interface RepresentationGraphRecord {
  id: string;
  projectId?: string;
  diagramSetId?: string;
  layers: RepresentationLayerRecord[];
  transitions: RepresentationTransitionRecord[];
  /** Optional so pre-feedback graph records remain readable. */
  recipes?: RepresentationRecipe[];
  feedback?: RepresentationFeedbackRecord[];
  createdAt?: string;
  updatedAt?: string;
}

function targetKey(target: RepresentationFeedbackTarget): string {
  return target.kind === "layer" ? `layer:${target.layerId}` : `transition:${target.transitionId}`;
}

function evidenceKey(reference: RepresentationEvidenceReference): string {
  return [reference.evidenceId, reference.sourceRangeId ?? "", reference.sourceRangeIndex ?? "", reference.elementId ?? ""].join("\0");
}

function compareEvidence(left: RepresentationEvidenceReference, right: RepresentationEvidenceReference): number {
  return evidenceKey(left).localeCompare(evidenceKey(right));
}

function assertId(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} must not be empty`);
}

function assertTargetExists(graph: RepresentationGraphRecord, target: RepresentationFeedbackTarget): void {
  const exists = target.kind === "layer"
    ? graph.layers.some((layer) => layer.id === target.layerId)
    : graph.transitions.some((transition) => transition.id === target.transitionId);
  if (!exists) throw new Error(`unknown representation ${targetKey(target)}`);
}

function assertEvidence(reference: RepresentationEvidenceReference): void {
  assertId(reference.evidenceId, "evidence id");
  if (reference.sourceRangeIndex !== undefined
    && (!Number.isInteger(reference.sourceRangeIndex) || reference.sourceRangeIndex < 0)) {
    throw new Error("evidence sourceRangeIndex must be a non-negative integer");
  }
}

function topologicalLayerIds(graph: RepresentationGraphRecord): string[] {
  const layerById = new Map(graph.layers.map((layer) => [layer.id, layer]));
  const indegree = new Map(graph.layers.map((layer) => [layer.id, 0]));
  const children = new Map(graph.layers.map((layer) => [layer.id, [] as string[]]));
  for (const transition of graph.transitions) {
    if (!layerById.has(transition.fromLayerId) || !layerById.has(transition.toLayerId)) continue;
    indegree.set(transition.toLayerId, (indegree.get(transition.toLayerId) ?? 0) + 1);
    children.get(transition.fromLayerId)!.push(transition.toLayerId);
  }
  const compare = (left: string, right: string) => {
    const a = layerById.get(left)!;
    const b = layerById.get(right)!;
    return a.informationRank - b.informationRank || a.id.localeCompare(b.id);
  };
  const ready = graph.layers.filter((layer) => indegree.get(layer.id) === 0).map((layer) => layer.id).sort(compare);
  const ordered: string[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    ordered.push(id);
    for (const childId of children.get(id)!.sort(compare)) {
      const next = indegree.get(childId)! - 1;
      indegree.set(childId, next);
      if (next === 0) {
        ready.push(childId);
        ready.sort(compare);
      }
    }
  }
  return ordered;
}

export function assertRepresentationGraph(graph: RepresentationGraphRecord): void {
  assertId(graph.id, "representation graph id");
  if (graph.layers.length === 0) throw new Error("representation graph must contain at least one layer");
  const layerIds = new Set<string>();
  for (const layer of graph.layers) {
    assertId(layer.id, "layer id");
    if (layerIds.has(layer.id)) throw new Error(`duplicate representation layer id: ${layer.id}`);
    layerIds.add(layer.id);
    if (!Number.isInteger(layer.informationRank) || layer.informationRank < 0) {
      throw new Error(`layer ${layer.id} informationRank must be a non-negative integer`);
    }
    assertId(layer.artifactRevision.artifactId, "artifact id");
    if (!/^[a-f\d]{64}$/i.test(layer.artifactRevision.asciiSha256)) {
      throw new Error(`layer ${layer.id} artifact revision must have a SHA-256`);
    }
    for (const reference of layer.evidenceReferences ?? []) assertEvidence(reference);
  }
  const transitionIds = new Set<string>();
  const edgeIds = new Set<string>();
  for (const transition of graph.transitions) {
    assertId(transition.id, "transition id");
    if (transitionIds.has(transition.id)) throw new Error(`duplicate representation transition id: ${transition.id}`);
    transitionIds.add(transition.id);
    if (!layerIds.has(transition.fromLayerId) || !layerIds.has(transition.toLayerId)) {
      throw new Error(`transition ${transition.id} references an unknown layer`);
    }
    const edge = `${transition.fromLayerId}\0${transition.toLayerId}`;
    if (edgeIds.has(edge)) throw new Error(`duplicate representation transition: ${transition.fromLayerId} -> ${transition.toLayerId}`);
    edgeIds.add(edge);
    for (const reference of transition.evidenceReferences ?? []) assertEvidence(reference);
  }
  if (topologicalLayerIds(graph).length !== graph.layers.length) {
    throw new Error("representation graph must be acyclic");
  }
  const layerById = new Map(graph.layers.map((layer) => [layer.id, layer]));
  for (const transition of graph.transitions) {
    const from = layerById.get(transition.fromLayerId)!;
    const to = layerById.get(transition.toLayerId)!;
    if (from.informationRank >= to.informationRank) {
      throw new Error(`transition ${transition.id} must increase informationRank`);
    }
  }
  const feedbackById = new Map<string, RepresentationFeedbackRecord>();
  for (const feedback of graph.feedback ?? []) {
    assertId(feedback.id, "feedback id");
    if (feedbackById.has(feedback.id)) throw new Error(`duplicate representation feedback id: ${feedback.id}`);
    assertTargetExists(graph, feedback.target);
    feedbackById.set(feedback.id, feedback);
  }
  const recipeKeys = new Set<string>();
  for (const recipe of graph.recipes ?? []) {
    assertId(recipe.id, "recipe id");
    if (!Number.isInteger(recipe.revision) || recipe.revision < 1) throw new Error("recipe revision must be a positive integer");
    const key = `${recipe.id}@${recipe.revision}`;
    if (recipeKeys.has(key)) throw new Error(`duplicate representation recipe revision: ${key}`);
    recipeKeys.add(key);
    assertTargetExists(graph, recipe.target);
    for (const feedbackId of recipe.incorporatedFeedbackIds) {
      const feedback = feedbackById.get(feedbackId);
      if (!feedback) throw new Error(`recipe ${key} references unknown feedback: ${feedbackId}`);
      if (targetKey(feedback.target) !== targetKey(recipe.target)) {
        throw new Error(`recipe ${key} incorporates feedback for another target`);
      }
    }
  }
  for (const layer of graph.layers) if (layer.recipe && !recipeKeys.has(`${layer.recipe.recipeId}@${layer.recipe.revision}`)) {
    throw new Error(`layer ${layer.id} references an unknown recipe revision`);
  }
  for (const transition of graph.transitions) if (transition.recipe && !recipeKeys.has(`${transition.recipe.recipeId}@${transition.recipe.revision}`)) {
    throw new Error(`transition ${transition.id} references an unknown recipe revision`);
  }
}

export function orderRepresentationLayers(graph: RepresentationGraphRecord): RepresentationLayerRecord[] {
  assertRepresentationGraph(graph);
  const byId = new Map(graph.layers.map((layer) => [layer.id, layer]));
  return topologicalLayerIds(graph).map((id) => byId.get(id)!);
}

export function normalizeRepresentationGraph(graph: RepresentationGraphRecord): RepresentationGraphRecord {
  assertRepresentationGraph(graph);
  const layers = orderRepresentationLayers(graph).map((layer) => ({
    ...layer,
    evidenceReferences: [...(layer.evidenceReferences ?? [])].sort(compareEvidence)
  }));
  const layerOrder = new Map(layers.map((layer, index) => [layer.id, index]));
  const transitions = graph.transitions.map((transition) => ({
    ...transition,
    evidenceReferences: [...(transition.evidenceReferences ?? [])].sort(compareEvidence)
  })).sort((left, right) =>
    layerOrder.get(left.fromLayerId)! - layerOrder.get(right.fromLayerId)!
    || layerOrder.get(left.toLayerId)! - layerOrder.get(right.toLayerId)!
    || left.id.localeCompare(right.id));
  return {
    ...graph,
    layers,
    transitions,
    recipes: [...(graph.recipes ?? [])].sort((a, b) => a.id.localeCompare(b.id) || a.revision - b.revision),
    feedback: [...(graph.feedback ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  };
}

export function appendRepresentationFeedback(
  graph: RepresentationGraphRecord,
  feedback: RepresentationFeedbackRecord
): RepresentationGraphRecord {
  assertRepresentationGraph(graph);
  if ((graph.feedback ?? []).some((entry) => entry.id === feedback.id)) {
    throw new Error(`duplicate representation feedback id: ${feedback.id}`);
  }
  assertTargetExists(graph, feedback.target);
  if (!feedback.comment.trim()) throw new Error("feedback comment must not be empty");
  return normalizeRepresentationGraph({ ...graph, feedback: [...(graph.feedback ?? []), { ...feedback }] });
}

export function reviseRepresentationRecipe(
  current: RepresentationRecipe,
  feedback: readonly RepresentationFeedbackRecord[],
  update: { instruction: string; createdAt: string }
): RepresentationRecipe {
  if (feedback.length === 0) throw new Error("a recipe revision must incorporate feedback");
  if (!update.instruction.trim()) throw new Error("recipe instruction must not be empty");
  const ids = new Set<string>();
  for (const entry of feedback) {
    if (targetKey(entry.target) !== targetKey(current.target)) {
      throw new Error("recipe feedback target does not match the recipe target");
    }
    if (ids.has(entry.id)) throw new Error(`duplicate recipe feedback id: ${entry.id}`);
    ids.add(entry.id);
  }
  return {
    id: current.id,
    revision: current.revision + 1,
    target: { ...current.target },
    instruction: update.instruction,
    supersedesRevision: current.revision,
    incorporatedFeedbackIds: [...new Set([...current.incorporatedFeedbackIds, ...ids])].sort(),
    createdAt: update.createdAt
  };
}
