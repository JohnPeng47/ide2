import { createHash } from "node:crypto";
import path from "node:path";
import {
  CALL_GRAPH_FOCUS_VERSION,
  focusIdentityKey,
  type CallGraphFocusRequest,
  type CallGraphFocusResult,
  type CodeEntityFocusIdentity
} from "../../src/core/callGraphFocus";
import {
  GLOBAL_IMPORTS_DIAGRAM_SET_ID,
  SCHEMA_VERSION,
  assertSevenBitAscii,
  assertSourceRange,
  isDiagramArchived,
  normalizeAscii,
  slugify,
  type ArtifactImportInput,
  type CodeEntityRecord,
  type DiagramComponentRecord,
  type DiagramRecord,
  type DiagramSetRecord,
  type DiagramViewKind,
  type GenerationOutputKind,
  type MappedArtifactBundle,
  type RepositoryDirectoryListing,
  type WorkspaceSnapshot
} from "../../src/core/domain";
import type { BuiltInDomainProfileId, CorpusBinding } from "../../src/core/domainProfile";
import { representationKindForArtifact } from "../../src/core/domainProfiles";
import type { HighlightRecordV2 } from "../../src/core/highlights";
import type { ProjectFileCompactionInput } from "../../src/core/projectCatalog";
import { buildRepresentationIndex, representationElementIdForMapping, treeRepresentationLineage } from "../../src/core/representationIndex";
import { filterCallGraphTree, parseCallGraphTree } from "./callGraphTree";
import { corpusProvider, readCorpusDocumentLines } from "./corpus";
import { validateDiagramMappings } from "./diagramMapping";
import { DiagramStore } from "./store";

function timestamp(): string {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function parseArtifactOrigin(value: unknown, label: string): { projectId: string; diagramSetId: string } {
  if (!isRecord(value)) throw new Error(`${label} is missing provenance`);
  return {
    projectId: requiredString(value.projectId, `${label} projectId`),
    diagramSetId: requiredString(value.diagramSetId, `${label} diagramSetId`)
  };
}

function parseCallGraphFocusRequest(value: unknown): CallGraphFocusRequest {
  if (!isRecord(value)) throw new Error("call-graph focus request must be an object");
  if (value.version !== CALL_GRAPH_FOCUS_VERSION) {
    throw new Error(`unsupported call-graph focus request version: ${String(value.version)}`);
  }
  if (!isRecord(value.sourceDiagram) || value.sourceDiagram.kind !== "diagram") {
    throw new Error("call-graph focus request requires a qualified source Diagram");
  }
  if (!Array.isArray(value.selectedCodeEntities) || value.selectedCodeEntities.length === 0) {
    throw new Error("call-graph focus request requires at least one selected CodeEntity");
  }
  const sourceOrigin = parseArtifactOrigin(value.sourceDiagram.origin, "source Diagram");
  const selectedCodeEntities: CodeEntityFocusIdentity[] = value.selectedCodeEntities.map(
    (candidate, index) => {
      if (!isRecord(candidate) || candidate.kind !== "code-entity") {
        throw new Error(`selected CodeEntity ${index + 1} is invalid`);
      }
      const origin = parseArtifactOrigin(candidate.origin, `selected CodeEntity ${index + 1}`);
      if (!isRecord(candidate.origin)) throw new Error(`selected CodeEntity ${index + 1} is missing provenance`);
      return {
        kind: "code-entity",
        targetId: requiredString(candidate.targetId, `selected CodeEntity ${index + 1} targetId`),
        origin: {
          ...origin,
          codeEntitiesSetId: requiredString(
            candidate.origin.codeEntitiesSetId,
            `selected CodeEntity ${index + 1} codeEntitiesSetId`
          )
        }
      };
    }
  );
  return {
    version: CALL_GRAPH_FOCUS_VERSION,
    diagramSetId: requiredString(value.diagramSetId, "diagramSetId"),
    sourceDiagram: {
      kind: "diagram",
      targetId: requiredString(value.sourceDiagram.targetId, "source Diagram targetId"),
      origin: sourceOrigin
    },
    selectedCodeEntities
  };
}

function sameArtifactOrigin(
  left: { projectId: string; diagramSetId: string },
  right: { projectId: string; diagramSetId: string }
): boolean {
  return left.projectId === right.projectId && left.diagramSetId === right.diagramSetId;
}

function identityForRecord(entity: CodeEntityRecord): CodeEntityFocusIdentity {
  if (!entity.origin) throw new Error(`CodeEntity ${entity.id} is missing provenance`);
  return { kind: "code-entity", targetId: entity.id, origin: entity.origin };
}
export class CoreApplication {
 constructor(readonly store: DiagramStore) {}

 async projectRepresentations() {
   const project = await this.store.loadProject();
   return { project, catalog: project
     ? await this.store.projectCatalogs.loadRepresentationCatalog(project.id) : null };
 }

  protected async projectCorpus(set?: DiagramSetRecord): Promise<{
    domainProfileId: BuiltInDomainProfileId;
    corpus: CorpusBinding;
  }> {
    const project = await this.store.loadProject();
    if (!project) throw new Error("project corpus is not initialized");
    if (set && set.projectId !== project.id) throw new Error("DiagramSet belongs to another project");
    const domainProfileId = project.domainProfileId === "document" ? "document" : "source-code";
    return { domainProfileId, corpus: project.corpus };
  }

  protected async settledViewIdsForSession(
    set: DiagramSetRecord
  ): Promise<Partial<Record<DiagramViewKind, string>>> {
    const project = await this.store.loadProject();
    if (!project) throw new Error("project corpus is not initialized");
    const catalog = await this.store.projectCatalogs.loadRepresentationCatalog(project.id);
    const result: Partial<Record<DiagramViewKind, string>> = {};
    const settled = Object.values(catalog.representations)
      .filter((representation) => representation.status === "settled")
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
    for (const representation of settled) {
      const revision = catalog.revisions[representation.currentRevisionId];
      if (revision?.provenance?.diagramSetId === set.id) {
        result[representation.viewKind] = revision.provenance.artifactId;
      }
    }
    for (const [viewKind, representationId] of Object.entries(catalog.activeByKind)) {
      const representation = representationId ? catalog.representations[representationId] : undefined;
      const revision = representation
        ? catalog.revisions[representation.currentRevisionId]
        : undefined;
      if (representation?.status === "settled" && revision?.provenance?.diagramSetId === set.id) {
        result[viewKind as DiagramViewKind] = revision.provenance.artifactId;
      }
    }
    return result;
  }

  async upsertProjectFileCompaction(input: ProjectFileCompactionInput): Promise<WorkspaceSnapshot> {
    const project = await this.store.loadProject();
    if (!project) throw new Error("project corpus is not initialized");
    if (input.makeActive !== false) {
      const documentLines = await readCorpusDocumentLines(project.corpus, input.path);
      // Source coordinates count the final newline as the terminator of the last
      // source line, not as an additional empty line.
      const liveLines = documentLines.at(-1) === "" ? documentLines.slice(0, -1) : documentLines;
      const captured = liveLines.slice(input.startLine - 1, input.endLine);
      if (JSON.stringify(captured) !== JSON.stringify(input.originalLines)) {
        throw new Error(`active compaction snapshot is stale for ${input.path}`);
      }
      if (input.startLine === 1 && input.originalLines.length === input.endLine
        && liveLines.length !== input.endLine) {
        throw new Error(`active full-file compaction does not cover current ${input.path}`);
      }
    }
    await this.store.projectCatalogs.upsertFileCompaction(project.id, input);
    return this.workspace();
  }

  protected async artifactForDiagramSet(
    setId: string,
    artifactKind: GenerationOutputKind,
    artifactId: string
  ): Promise<{
    artifact: DiagramRecord | DiagramComponentRecord;
    global: boolean;
  }> {
    const set = await this.store.loadDiagramSet(setId);
    const local = artifactKind === "diagram"
      ? set.diagramIds.includes(artifactId)
      : set.diagramComponentIds.includes(artifactId);
    if (local) {
      return {
        artifact: artifactKind === "diagram"
          ? await this.store.loadDiagram(setId, artifactId)
          : await this.store.loadDiagramComponent(setId, artifactId),
        global: false
      };
    }
    const library = await this.store.loadImportedArtifactLibrary();
    const global = artifactKind === "diagram"
      ? library.diagramIds.includes(artifactId)
      : library.diagramComponentIds.includes(artifactId);
    if (!global) throw new Error(`unknown ${artifactKind}: ${artifactId}`);
    return {
      artifact: artifactKind === "diagram"
        ? await this.store.loadImportedDiagram(artifactId)
        : await this.store.loadImportedDiagramComponent(artifactId),
      global: true
    };
  }

  async mappedArtifactBundle(
    setId: string,
    artifactKind: GenerationOutputKind,
    artifactId: string
  ): Promise<MappedArtifactBundle> {
    const { artifact, global } = await this.artifactForDiagramSet(setId, artifactKind, artifactId);
    const localSet = await this.store.loadCodeEntities(setId);
    const library = await this.store.loadImportedArtifactLibrary();
    const imported = await Promise.all(
      (library.codeEntityIds ?? []).map((id) => this.store.loadImportedCodeEntity(id))
    );
    const available = new Map(
      [...localSet.entities, ...imported].map((entity) => [entity.id, entity])
    );
    const codeEntities = artifact.codeEntityIds.map((id) => available.get(id)).filter(
      (entity): entity is CodeEntityRecord => Boolean(entity)
    );
    if (codeEntities.length !== new Set(artifact.codeEntityIds).size) {
      throw new Error("artifact has unresolved CodeEntity dependencies");
    }
    const codeEntityMap = global
      ? await this.store.loadImportedCodeEntityMap(artifactId)
        ?? await this.store.loadCodeEntityMap(setId, artifactId)
      : await this.store.loadCodeEntityMap(setId, artifactId);
    return {
      bundleVersion: 1,
      artifactKind,
      artifact,
      codeEntities,
      ...(codeEntityMap ? { codeEntityMap } : {})
    };
  }

  async callGraphFocus(input: unknown): Promise<CallGraphFocusResult> {
    const request = parseCallGraphFocusRequest(input);
    const set = await this.store.loadDiagramSet(request.diagramSetId);
    const { artifact: sourceArtifact } = await this.artifactForDiagramSet(
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

    const settledViewIds = await this.settledViewIdsForSession(set);
    const callGraphId = settledViewIds["call-graph"];
    if (!callGraphId) throw new Error("generation session has no settled call graph");
    const { artifact: callGraphArtifact } = await this.artifactForDiagramSet(
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

    const local = await this.store.loadCodeEntities(set.id);
    const library = await this.store.loadImportedArtifactLibrary();
    const imported = await Promise.all(
      (library.codeEntityIds ?? []).map((id) => this.store.loadImportedCodeEntity(id))
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

  async importArtifact(input: ArtifactImportInput): Promise<WorkspaceSnapshot> {
    if (input.artifactKind !== "diagram" && input.artifactKind !== "diagram-component") {
      throw new Error("artifact kind must be diagram or diagram-component");
    }
    const name = input.name.trim();
    if (!name) throw new Error("artifact name is required");
    if (name.length > 120) throw new Error("artifact name cannot exceed 120 characters");
    const ascii = normalizeAscii(input.ascii);
    assertSevenBitAscii(ascii);
    if (ascii.length > 20000) throw new Error("artifact ASCII cannot exceed 20,000 characters");

    const workspace = await this.workspace();
    const bundle = input.bundle;
    if (bundle) {
      if (bundle.bundleVersion !== 1 || bundle.artifactKind !== input.artifactKind) {
        throw new Error("mapped artifact bundle kind or version is invalid");
      }
      if (bundle.artifact.ascii !== input.ascii) {
        throw new Error("mapped artifact bundle ASCII cannot be edited during import");
      }
      if (!bundle.artifact.recordOrigin) {
        throw new Error("mapped artifact bundle is missing artifact provenance");
      }
      const dependencies = new Map(bundle.codeEntities.map((entity) => [entity.id, entity]));
      for (const id of bundle.artifact.codeEntityIds) {
        if (!dependencies.has(id)) throw new Error(`mapped artifact bundle is missing CodeEntity: ${id}`);
      }
      for (const entity of bundle.codeEntities) {
        if (!entity.origin) throw new Error(`CodeEntity ${entity.id} is missing provenance`);
        if (entity.sourceRanges.some((range) => !range.id)) {
          throw new Error(`CodeEntity ${entity.id} has a source range without an id`);
        }
      }
      if (bundle.codeEntityMap) {
        if (bundle.codeEntityMap.artifactId !== bundle.artifact.id
          || bundle.codeEntityMap.artifactKind !== input.artifactKind) {
          throw new Error("mapped artifact bundle has a mismatched CodeEntity map");
        }
        const asciiSha256 = createHash("sha256").update(ascii).digest("hex");
        if (bundle.codeEntityMap.asciiSha256 !== asciiSha256) {
          throw new Error("mapped artifact bundle has stale ASCII mapping bounds");
        }
        const mappingIds = bundle.codeEntityMap.mappings.map((mapping) => mapping.id);
        if (new Set(mappingIds).size !== mappingIds.length) {
          throw new Error("mapped artifact bundle has duplicate mapping ids");
        }
        for (const mapping of bundle.codeEntityMap.mappings) {
          const entity = dependencies.get(mapping.entityId);
          if (!entity || !bundle.artifact.codeEntityIds.includes(mapping.entityId)) {
            throw new Error(`CodeEntity map references an unavailable dependency: ${mapping.entityId}`);
          }
          if (!Number.isInteger(mapping.sourceRangeIndex)
            || !entity.sourceRanges[mapping.sourceRangeIndex]) {
            throw new Error(`CodeEntity map references an unavailable source range: ${mapping.entityId}`);
          }
          if (mapping.sourceRangeId
            && entity.sourceRanges[mapping.sourceRangeIndex].id !== mapping.sourceRangeId) {
            throw new Error(`CodeEntity map has a mismatched source range identity: ${mapping.entityId}`);
          }
        }
        validateDiagramMappings(ascii, bundle.codeEntityMap.mappings, bundle.codeEntities);
      }
      for (const entity of bundle.codeEntities) await this.store.addImportedCodeEntity(entity);
    }
    const existing = input.artifactKind === "diagram"
      ? Object.values(workspace.diagrams)
      : Object.values(workspace.diagramComponents);
    const handles = new Set(existing.map((artifact) => artifact.handle));
    const fallback = input.artifactKind === "diagram" ? "imported-diagram" : "imported-component";
    const baseHandle = slugify(name, fallback);
    let handle = baseHandle;
    let suffix = 2;
    while (handles.has(handle)) handle = `${baseHandle}-${suffix++}`;

    if (input.artifactKind === "diagram") {
      const diagram: DiagramRecord = {
        ...(bundle?.artifact as DiagramRecord | undefined),
        schemaVersion: SCHEMA_VERSION,
        id: bundle?.artifact.id ?? this.store.ids.diagram(),
        recordOrigin: bundle?.artifact.recordOrigin ?? {
          projectId: workspace.project?.id ?? "unowned",
          diagramSetId: GLOBAL_IMPORTS_DIAGRAM_SET_ID
        },
        diagramSetId: GLOBAL_IMPORTS_DIAGRAM_SET_ID,
        viewKind: bundle && "viewKind" in bundle.artifact ? bundle.artifact.viewKind : "diagram",
        representationKind: bundle
          ? representationKindForArtifact(bundle.artifact as DiagramRecord)
          : "diagram",
        handle,
        name,
        ascii,
        codeEntityIds: bundle?.artifact.codeEntityIds ?? [],
        origin: "imported",
        derivedFromDiagramIds: bundle && "derivedFromDiagramIds" in bundle.artifact
          ? bundle.artifact.derivedFromDiagramIds
          : [],
        createdAt: timestamp()
      };
      await this.store.addImportedDiagram(diagram);
      if (bundle?.codeEntityMap) await this.store.addImportedCodeEntityMap(bundle.codeEntityMap);
    } else {
      const component: DiagramComponentRecord = {
        ...(bundle?.artifact as DiagramComponentRecord | undefined),
        schemaVersion: SCHEMA_VERSION,
        id: bundle?.artifact.id ?? this.store.ids.diagramComponent(),
        recordOrigin: bundle?.artifact.recordOrigin ?? {
          projectId: workspace.project?.id ?? "unowned",
          diagramSetId: GLOBAL_IMPORTS_DIAGRAM_SET_ID
        },
        diagramSetId: GLOBAL_IMPORTS_DIAGRAM_SET_ID,
        handle,
        name,
        ascii,
        representationKind: bundle
          ? representationKindForArtifact(bundle.artifact)
          : "diagram",
        codeEntityIds: bundle?.artifact.codeEntityIds ?? [],
        origin: "imported",
        derivedFromDiagramIds: bundle?.artifact.derivedFromDiagramIds ?? [],
        derivedFromDiagramComponentIds: bundle && "derivedFromDiagramComponentIds" in bundle.artifact
          ? bundle.artifact.derivedFromDiagramComponentIds
          : [],
        createdAt: timestamp()
      };
      await this.store.addImportedDiagramComponent(component);
      if (bundle?.codeEntityMap) await this.store.addImportedCodeEntityMap(bundle.codeEntityMap);
    }
    return this.workspace();
  }

  async renameImportedDiagram(diagramId: string, name: string): Promise<WorkspaceSnapshot> {
    const normalized = name.trim();
    if (!normalized) throw new Error("Diagram name is required");
    if (normalized.length > 120) throw new Error("Diagram name cannot exceed 120 characters");
    const diagram = await this.store.loadImportedDiagram(diagramId);
    if (isDiagramArchived(diagram)) throw new Error("archived diagrams cannot be renamed");
    await this.store.renameImportedDiagram(diagramId, normalized);
    return this.workspace();
  }

  async archiveImportedDiagram(diagramId: string): Promise<WorkspaceSnapshot> {
    await this.store.archiveImportedDiagram(diagramId);
    await this.store.clearFeaturedViewReferences(diagramId);
    return this.workspace();
  }

  async archiveImportedDiagramComponent(componentId: string): Promise<WorkspaceSnapshot> {
    await this.store.archiveImportedDiagramComponent(componentId);
    return this.workspace();
  }

  async sourceSnippet(setId: string, entityId: string, rangeIndex: number): Promise<{
    path: string;
    startLine: number;
    lines: string[];
  }> {
    const set = await this.store.loadDiagramSet(setId);
    const entities = await this.store.loadCodeEntities(setId);
    const entity = entities.entities.find((candidate) => candidate.id === entityId);
    if (!entity) throw new Error(`unknown CodeEntity: ${entityId}`);
    const range = entity.sourceRanges[rangeIndex];
    if (!range) throw new Error("unknown source range");
    assertSourceRange(range);
    const { corpus } = await this.projectCorpus(set);
    const lines = await readCorpusDocumentLines(corpus, range.path);
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

  async addHighlight(input: {
    diagramSetId: unknown;
    artifactKind: unknown;
    artifactId: unknown;
    mappingId: unknown;
  }): Promise<WorkspaceSnapshot> {
    const diagramSetId = typeof input.diagramSetId === "string" ? input.diagramSetId : "";
    const artifactId = typeof input.artifactId === "string" ? input.artifactId : "";
    const mappingId = typeof input.mappingId === "string" ? input.mappingId : "";
    const artifactKind = input.artifactKind;
    if (!diagramSetId || !artifactId || !mappingId) throw new Error("highlight target is incomplete");
    if (artifactKind !== "diagram" && artifactKind !== "diagram-component") {
      throw new Error("highlight artifact kind must be diagram or diagram-component");
    }
    const set = await this.store.loadDiagramSet(diagramSetId);
    const bundle = await this.mappedArtifactBundle(diagramSetId, artifactKind, artifactId);
    const mapping = bundle.codeEntityMap?.mappings.find((candidate) => candidate.id === mappingId);
    if (!mapping) throw new Error(`unknown mapped tree node: ${mappingId}`);
    const entity = bundle.codeEntities.find((candidate) => candidate.id === mapping.entityId);
    if (!entity) throw new Error(`unknown mapped CodeEntity: ${mapping.entityId}`);
    const range = mapping.sourceRangeId
      ? entity.sourceRanges.find((candidate) => candidate.id === mapping.sourceRangeId)
      : entity.sourceRanges[mapping.sourceRangeIndex];
    if (!range) throw new Error("mapped source range was not found");
    const revision = {
      artifactId: bundle.artifact.id,
      asciiSha256: createHash("sha256").update(bundle.artifact.ascii).digest("hex")
    };
    const representationKind = representationKindForArtifact(bundle.artifact);
    const representationIndex = buildRepresentationIndex({
      kind: representationKind,
      revision,
      ascii: bundle.artifact.ascii,
      codeEntityMap: bundle.codeEntityMap
    });
    const representationElementId = representationElementIdForMapping(representationIndex, mappingId);
    if (!representationElementId) throw new Error(`mapped representation element was not found: ${mappingId}`);
    const rawLine = bundle.artifact.ascii.replace(/\r\n?/g, "\n").split("\n")[mapping.line - 1] ?? "";
    const elementText = representationIndex.kind === "tree"
      ? representationIndex.nodes[representationElementId]?.text ?? rawLine.trim()
      : rawLine.slice(mapping.startColumn - 1, mapping.endColumn).trim();
    if (!elementText) throw new Error("mapped representation element has no display text");
    const highlightBase = {
      schemaVersion: 2 as const,
      id: this.store.ids.highlight(),
      projectId: set.projectId,
      diagramSetId,
      artifactKind,
      artifactId,
      artifactName: bundle.artifact.name,
      artifactRevision: revision,
      representationElementId,
      mappingId,
      elementText,
      evidence: {
        evidenceId: entity.id,
        ...(range.id ? { sourceRangeId: range.id } : {}),
        sourceRangeIndex: mapping.sourceRangeIndex
      },
      ...(range.originalLines ? { documentExcerpt: {
        path: range.path,
        startLine: range.startLine,
        endLine: range.endLine,
        lines: [...range.originalLines]
      } } : {}),
      createdAt: timestamp()
    };
    const highlight: HighlightRecordV2 = representationIndex.kind === "tree"
      ? {
          ...highlightBase,
          representationKind: "tree",
          treeLineage: treeRepresentationLineage(representationIndex, representationElementId)
            .map((node) => ({
              representationElementId: node.id,
              line: node.line,
              text: node.text
            }))
        }
      : { ...highlightBase, representationKind: "diagram" };
    await this.store.saveHighlight(highlight);
    return this.workspace();
  }

  async deleteHighlight(highlightId: string): Promise<WorkspaceSnapshot> {
    await this.store.deleteHighlight(highlightId);
    return this.workspace();
  }

  async listRepositoryDirectory(
    setId: string,
    relativeDirectory: string
  ): Promise<RepositoryDirectoryListing> {
    const set = await this.store.loadDiagramSet(setId);
    const { corpus } = await this.projectCorpus(set);
    const listing = await corpusProvider(corpus).listDirectory(corpus, relativeDirectory);
    const storeRoot = path.resolve(this.store.storeRoot);
    const root = path.resolve(corpus.root);
    return {
      directory: listing.directory,
      entries: listing.entries.filter(
        (entry) => path.resolve(root, entry.path) !== storeRoot
      )
    };
  }

  workspace(): Promise<WorkspaceSnapshot> {
    return this.store.loadWorkspace();
  }
}
