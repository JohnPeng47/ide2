import path from "node:path";
import type { BuiltInDomainProfileId, CorpusBinding } from "../../../domain/core/profiles/domainProfile";
import {
  assertSourceRange,
  type CodeEntityRecord,
  type DiagramRecord,
  type DiagramSetRecord,
  type RepositoryDirectoryListing
} from "../../../domain/core/records/domain";
import {
  CALL_GRAPH_FOCUS_VERSION,
  focusIdentityKey,
  type CallGraphFocusResult,
  type CodeEntityFocusIdentity
} from "../../../domain/core/source/callGraphFocus";
import { filterCallGraphTree, parseCallGraphTree } from "../../../domain/core/source/callGraphTree";
import type { CoreContext } from '../context';
import { artifactForDiagramSet } from '../imports/service';
import { settledViewIdsForSession } from '../representations/service';
import { identityForRecord, parseCallGraphFocusRequest, sameArtifactOrigin } from '../shared';

export async function projectCorpus(context: CoreContext, set?: DiagramSetRecord): Promise<{
  domainProfileId: BuiltInDomainProfileId;
  corpus: CorpusBinding;
}> {
  const project = await context.store.loadProject();
  if (!project) throw new Error("project corpus is not initialized");
  if (set && set.projectId !== project.id) throw new Error("DiagramSet belongs to another project");
  const domainProfileId = project.domainProfileId === "document" ? "document" : "source-code";
  return { domainProfileId, corpus: project.corpus };
}

export async function callGraphFocus(context: CoreContext, input: unknown): Promise<CallGraphFocusResult> {
  const request = parseCallGraphFocusRequest(input);
  const set = await context.store.loadDiagramSet(request.diagramSetId);
  const { artifact: sourceArtifact } = await artifactForDiagramSet(context,
    set.id,
    "diagram",
    request.sourceDiagram.targetId
  );
  const sourceDiagram = sourceArtifact as DiagramRecord;
  if (sourceDiagram.viewKind !== "diagram") {
    throw new Error("source Diagram must have diagram viewKind");
  }
  if (!sourceDiagram.recordOrigin
    || !sameArtifactOrigin(sourceDiagram.recordOrigin, request.sourceDiagram.origin)) {
    throw new Error("source Diagram provenance does not match the requested identity");
  }

  const settledViewIds = await settledViewIdsForSession(context, set);
  const callGraphId = settledViewIds["call-graph"];
  if (!callGraphId) throw new Error("generation session has no settled call graph");
  const { artifact: callGraphArtifact } = await artifactForDiagramSet(context,
    set.id,
    "diagram",
    callGraphId
  );
  const callGraph = callGraphArtifact as DiagramRecord;
  if (callGraph.viewKind !== "call-graph") {
    throw new Error("settled call graph does not have call-graph viewKind");
  }
  if (callGraph.basedOnDiagramId !== sourceDiagram.id) {
    throw new Error("settled call graph is based on another Diagram");
  }
  if (!callGraph.recordOrigin) throw new Error("settled call graph is missing provenance");

  const local = await context.store.loadCodeEntities(set.id);
  const library = await context.store.loadImportedArtifactLibrary();
  const imported = await Promise.all(
    (library.codeEntityIds ?? []).map((id) => context.store.loadImportedCodeEntity(id))
  );
  const available = new Map(
    [...local.entities, ...imported].map((entity) => [entity.id, entity])
  );
  const declaredEntities = callGraph.codeEntityIds.map((id) => available.get(id));
  const missingDependency = callGraph.codeEntityIds.find((_, index) => !declaredEntities[index]);
  if (missingDependency) {
    throw new Error(`settled call graph has unresolved CodeEntity dependency: ${missingDependency}`);
  }

  const selected = new Map<string, CodeEntityFocusIdentity>();
  for (const identity of request.selectedCodeEntities) {
    const entity = available.get(identity.targetId);
    if (!entity) throw new Error(`unknown selected CodeEntity: ${identity.targetId}`);
    if (!entity.origin || focusIdentityKey(identity) !== focusIdentityKey(identityForRecord(entity))) {
      throw new Error(`selected CodeEntity provenance does not match: ${identity.targetId}`);
    }
    if (!sourceDiagram.codeEntityIds.includes(identity.targetId)) {
      throw new Error(`selected CodeEntity is not declared by the source Diagram: ${identity.targetId}`);
    }
    if (!callGraph.codeEntityIds.includes(identity.targetId)) {
      throw new Error(`selected CodeEntity is not declared by the settled call graph: ${identity.targetId}`);
    }
    selected.set(focusIdentityKey(identity), identity);
  }

  const roots = parseCallGraphTree(
    callGraph.ascii,
    declaredEntities.filter((entity): entity is CodeEntityRecord => Boolean(entity))
  );
  const filteredRoots = filterCallGraphTree(roots, new Set(selected.keys()));
  if (filteredRoots.length === 0) {
    throw new Error("settled call graph contains no nodes for the selected CodeEntities");
  }
  return {
    version: CALL_GRAPH_FOCUS_VERSION,
    diagramSetId: set.id,
    sourceDiagram: request.sourceDiagram,
    callGraph: {
      kind: "diagram",
      targetId: callGraph.id,
      origin: callGraph.recordOrigin
    },
    callGraphName: callGraph.name,
    roots: filteredRoots
  };
}

export async function sourceSnippet(context: CoreContext, setId: string, entityId: string, rangeIndex: number): Promise<{
  path: string;
  startLine: number;
  lines: string[];
}> {
  const set = await context.store.loadDiagramSet(setId);
  const entities = await context.store.loadCodeEntities(setId);
  const entity = entities.entities.find((candidate) => candidate.id === entityId);
  if (!entity) throw new Error(`unknown CodeEntity: ${entityId}`);
  const range = entity.sourceRanges[rangeIndex];
  if (!range) throw new Error("unknown source range");
  assertSourceRange(range);
  const { corpus } = await projectCorpus(context, set);
  const lines = await context.corpus.readDocumentLines(corpus, range.path);
  if (range.originalLines) {
    const start = range.startLine - 1;
    while (lines.length < start) lines.push("");
    lines.splice(start, range.endLine - range.startLine + 1, ...range.originalLines);
  }
  return {
    path: range.path,
    startLine: 1,
    lines
  };
}

export async function listRepositoryDirectory(context: CoreContext, setId: string, relativeDirectory: string): Promise<RepositoryDirectoryListing> {
  const set = await context.store.loadDiagramSet(setId);
  const { corpus } = await projectCorpus(context, set);
  const listing = await context.corpus.provider(corpus).listDirectory(corpus, relativeDirectory);
  const storeRoot = path.resolve(context.store.storeRoot);
  const root = path.resolve(corpus.root);
  return {
    directory: listing.directory,
    entries: listing.entries.filter(
      (entry) => path.resolve(root, entry.path) !== storeRoot
    )
  };
}
