import { createHash } from "node:crypto";
import { validateDiagramMappings } from "../../../domain/core/diagrams/diagramMapping";
import { representationKindForArtifact } from "../../../domain/core/profiles/domainProfiles";
import {
  GLOBAL_IMPORTS_DIAGRAM_SET_ID,
  SCHEMA_VERSION,
  assertSevenBitAscii,
  isDiagramArchived,
  normalizeAscii,
  slugify,
  type ArtifactImportInput,
  type CodeEntityRecord,
  type DiagramComponentRecord,
  type DiagramRecord,
  type GenerationOutputKind,
  type MappedArtifactBundle,
  type WorkspaceSnapshot
} from "../../../domain/core/records/domain";
import type { CoreContext } from '../context';
import { timestamp } from '../shared';
import { workspace as loadWorkspace } from '../workspace/service';

export async function artifactForDiagramSet(context: CoreContext, setId: string, artifactKind: GenerationOutputKind, artifactId: string): Promise<{
  artifact: DiagramRecord | DiagramComponentRecord;
  global: boolean;
}> {
  const set = await context.store.loadDiagramSet(setId);
  const local = artifactKind === "diagram"
    ? set.diagramIds.includes(artifactId)
    : set.diagramComponentIds.includes(artifactId);
  if (local) {
    return {
      artifact: artifactKind === "diagram"
        ? await context.store.loadDiagram(setId, artifactId)
        : await context.store.loadDiagramComponent(setId, artifactId),
      global: false
    };
  }
  const library = await context.store.loadImportedArtifactLibrary();
  const global = artifactKind === "diagram"
    ? library.diagramIds.includes(artifactId)
    : library.diagramComponentIds.includes(artifactId);
  if (!global) throw new Error(`unknown ${artifactKind}: ${artifactId}`);
  return {
    artifact: artifactKind === "diagram"
      ? await context.store.loadImportedDiagram(artifactId)
      : await context.store.loadImportedDiagramComponent(artifactId),
    global: true
  };
}

export async function mappedArtifactBundle(context: CoreContext, setId: string, artifactKind: GenerationOutputKind, artifactId: string): Promise<MappedArtifactBundle> {
  const { artifact, global } = await artifactForDiagramSet(context, setId, artifactKind, artifactId);
  const localSet = await context.store.loadCodeEntities(setId);
  const library = await context.store.loadImportedArtifactLibrary();
  const imported = await Promise.all(
    (library.codeEntityIds ?? []).map((id) => context.store.loadImportedCodeEntity(id))
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
    ? await context.store.loadImportedCodeEntityMap(artifactId)
    ?? await context.store.loadCodeEntityMap(setId, artifactId)
    : await context.store.loadCodeEntityMap(setId, artifactId);
  return {
    bundleVersion: 1,
    artifactKind,
    artifact,
    codeEntities,
    ...(codeEntityMap ? { codeEntityMap } : {})
  };
}

export async function importArtifact(context: CoreContext, input: ArtifactImportInput): Promise<WorkspaceSnapshot> {
  if (input.artifactKind !== "diagram" && input.artifactKind !== "diagram-component") {
    throw new Error("artifact kind must be diagram or diagram-component");
  }
  const name = input.name.trim();
  if (!name) throw new Error("artifact name is required");
  if (name.length > 120) throw new Error("artifact name cannot exceed 120 characters");
  const ascii = normalizeAscii(input.ascii);
  assertSevenBitAscii(ascii);
  if (ascii.length > 20000) throw new Error("artifact ASCII cannot exceed 20,000 characters");

  const workspace = await loadWorkspace(context);
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
    for (const entity of bundle.codeEntities) await context.store.addImportedCodeEntity(entity);
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
      id: bundle?.artifact.id ?? context.store.ids.diagram(),
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
    await context.store.addImportedDiagram(diagram);
    if (bundle?.codeEntityMap) await context.store.addImportedCodeEntityMap(bundle.codeEntityMap);
  } else {
    const component: DiagramComponentRecord = {
      ...(bundle?.artifact as DiagramComponentRecord | undefined),
      schemaVersion: SCHEMA_VERSION,
      id: bundle?.artifact.id ?? context.store.ids.diagramComponent(),
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
    await context.store.addImportedDiagramComponent(component);
    if (bundle?.codeEntityMap) await context.store.addImportedCodeEntityMap(bundle.codeEntityMap);
  }
  return loadWorkspace(context);
}

export async function renameImportedDiagram(context: CoreContext, diagramId: string, name: string): Promise<WorkspaceSnapshot> {
  const normalized = name.trim();
  if (!normalized) throw new Error("Diagram name is required");
  if (normalized.length > 120) throw new Error("Diagram name cannot exceed 120 characters");
  const diagram = await context.store.loadImportedDiagram(diagramId);
  if (isDiagramArchived(diagram)) throw new Error("archived diagrams cannot be renamed");
  await context.store.renameImportedDiagram(diagramId, normalized);
  return loadWorkspace(context);
}

export async function archiveImportedDiagram(context: CoreContext, diagramId: string): Promise<WorkspaceSnapshot> {
  await context.store.archiveImportedDiagram(diagramId);
  await context.store.clearFeaturedViewReferences(diagramId);
  return loadWorkspace(context);
}

export async function archiveImportedDiagramComponent(context: CoreContext, componentId: string): Promise<WorkspaceSnapshot> {
  await context.store.archiveImportedDiagramComponent(componentId);
  return loadWorkspace(context);
}
