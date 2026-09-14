import {
  GLOBAL_IMPORTS_DIAGRAM_SET_ID,
  SCHEMA_VERSION,
  type CodeEntityRecord,
  type DiagramCodeEntityMapRecord,
  type DiagramComponentRecord,
  type DiagramRecord,
  type DiagramSetRecord,
  type DiagramViewKind,
  type ImportedArtifactLibraryRecord
} from "../../../domain/core/records/domain";
import { loadDiagram, loadDiagramComponent } from './artifacts';
import type { PersistenceContext } from './context';
import { importedCodeEntityMapPath, importedCodeEntityPath, importedDiagramComponentPath, importedDiagramPath, importsIndexPath, setPath } from './paths';
import { loadProject } from './projects';
import { nowIso, readJson, readJsonIfExists, writeJsonAtomic } from './shared';

export async function loadImportedArtifactLibrary(context: PersistenceContext): Promise<ImportedArtifactLibraryRecord> {
  const stored = await readJsonIfExists<ImportedArtifactLibraryRecord>(importsIndexPath(context));
  if (stored) return stored;
  const timestamp = nowIso();
  return {
    schemaVersion: SCHEMA_VERSION,
    diagramIds: [],
    diagramComponentIds: [],
    codeEntityIds: [],
    codeEntityMapArtifactIds: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export async function saveImportedArtifactLibrary(context: PersistenceContext, library: ImportedArtifactLibraryRecord): Promise<void> {
  await writeJsonAtomic(importsIndexPath(context), library);
}

export async function loadImportedDiagram(context: PersistenceContext, diagramId: string): Promise<DiagramRecord> {
  const filePath = importedDiagramPath(context, diagramId);
  const stored = await readJson<DiagramRecord & { viewKind?: DiagramViewKind }>(filePath);
  if (stored.viewKind && stored.recordOrigin) return stored as DiagramRecord;
  const project = await loadProject(context);
  const normalized: DiagramRecord = {
    ...stored,
    viewKind: stored.viewKind ?? "diagram",
    recordOrigin: stored.recordOrigin ?? {
      projectId: project?.id ?? "unowned",
      diagramSetId: GLOBAL_IMPORTS_DIAGRAM_SET_ID
    }
  };
  await writeJsonAtomic(filePath, normalized);
  return normalized;
}

export async function loadImportedDiagramComponent(context: PersistenceContext, componentId: string): Promise<DiagramComponentRecord> {
  const filePath = importedDiagramComponentPath(context, componentId);
  const stored = await readJson<DiagramComponentRecord>(filePath);
  if (stored.recordOrigin) return stored;
  const project = await loadProject(context);
  const normalized = {
    ...stored,
    recordOrigin: {
      projectId: project?.id ?? "unowned",
      diagramSetId: GLOBAL_IMPORTS_DIAGRAM_SET_ID
    }
  };
  await writeJsonAtomic(filePath, normalized);
  return normalized;
}

export async function loadImportedCodeEntity(context: PersistenceContext, entityId: string): Promise<CodeEntityRecord> {
  const stored = await readJson<{
    schemaVersion: typeof SCHEMA_VERSION;
    entity: CodeEntityRecord;
  }>(importedCodeEntityPath(context, entityId));
  return stored.entity;
}

export async function loadImportedCodeEntityMap(context: PersistenceContext, artifactId: string): Promise<DiagramCodeEntityMapRecord | null> {
  return readJsonIfExists<DiagramCodeEntityMapRecord>(importedCodeEntityMapPath(context, artifactId));
}

export async function addImportedCodeEntity(context: PersistenceContext, entity: CodeEntityRecord): Promise<void> {
  const library = await loadImportedArtifactLibrary(context);
  const ids = library.codeEntityIds ?? [];
  const existing = ids.includes(entity.id)
    ? await loadImportedCodeEntity(context, entity.id)
    : null;
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(entity)) {
      throw new Error(`conflicting imported CodeEntity: ${entity.id}`);
    }
    return;
  }
  await writeJsonAtomic(importedCodeEntityPath(context, entity.id), {
    schemaVersion: SCHEMA_VERSION,
    entity
  });
  await saveImportedArtifactLibrary(context, {
    ...library,
    codeEntityIds: [...ids, entity.id],
    updatedAt: nowIso()
  });
}

export async function addImportedCodeEntityMap(context: PersistenceContext, mapping: DiagramCodeEntityMapRecord): Promise<void> {
  const library = await loadImportedArtifactLibrary(context);
  const ids = library.codeEntityMapArtifactIds ?? [];
  if (ids.includes(mapping.artifactId)) {
    const existing = await loadImportedCodeEntityMap(context, mapping.artifactId);
    if (JSON.stringify(existing) !== JSON.stringify(mapping)) {
      throw new Error(`conflicting imported CodeEntity map: ${mapping.artifactId}`);
    }
    return;
  }
  await writeJsonAtomic(importedCodeEntityMapPath(context, mapping.artifactId), mapping);
  await saveImportedArtifactLibrary(context, {
    ...library,
    codeEntityMapArtifactIds: [...ids, mapping.artifactId],
    updatedAt: nowIso()
  });
}

export async function addImportedDiagram(context: PersistenceContext, diagram: DiagramRecord): Promise<void> {
  if (diagram.diagramSetId !== GLOBAL_IMPORTS_DIAGRAM_SET_ID || diagram.origin !== "imported") {
    throw new Error("global imported Diagram has invalid ownership");
  }
  const library = await loadImportedArtifactLibrary(context);
  if (library.diagramIds.includes(diagram.id)) throw new Error(`duplicate Diagram: ${diagram.id}`);
  await writeJsonAtomic(importedDiagramPath(context, diagram.id), diagram);
  await saveImportedArtifactLibrary(context, {
    ...library,
    diagramIds: [...library.diagramIds, diagram.id],
    updatedAt: nowIso()
  });
}

export async function addImportedDiagramComponent(context: PersistenceContext, component: DiagramComponentRecord): Promise<void> {
  if (component.diagramSetId !== GLOBAL_IMPORTS_DIAGRAM_SET_ID
    || component.origin !== "imported") {
    throw new Error("global imported DiagramComponent has invalid ownership");
  }
  const library = await loadImportedArtifactLibrary(context);
  if (library.diagramComponentIds.includes(component.id)) {
    throw new Error(`duplicate DiagramComponent: ${component.id}`);
  }
  await writeJsonAtomic(importedDiagramComponentPath(context, component.id), component);
  await saveImportedArtifactLibrary(context, {
    ...library,
    diagramComponentIds: [...library.diagramComponentIds, component.id],
    updatedAt: nowIso()
  });
}

export async function renameImportedDiagram(context: PersistenceContext, diagramId: string, name: string): Promise<DiagramRecord> {
  const library = await loadImportedArtifactLibrary(context);
  if (!library.diagramIds.includes(diagramId)) throw new Error(`unknown imported Diagram: ${diagramId}`);
  const diagram = await loadImportedDiagram(context, diagramId);
  const renamed = { ...diagram, name };
  await writeJsonAtomic(importedDiagramPath(context, diagramId), renamed);
  await saveImportedArtifactLibrary(context, { ...library, updatedAt: nowIso() });
  return renamed;
}

export async function archiveImportedDiagram(context: PersistenceContext, diagramId: string): Promise<DiagramRecord> {
  const library = await loadImportedArtifactLibrary(context);
  if (!library.diagramIds.includes(diagramId)) throw new Error(`unknown imported Diagram: ${diagramId}`);
  const diagram = await loadImportedDiagram(context, diagramId);
  if (diagram.archivedAt) return diagram;
  const archived = { ...diagram, archivedAt: nowIso() };
  await writeJsonAtomic(importedDiagramPath(context, diagramId), archived);
  await saveImportedArtifactLibrary(context, { ...library, updatedAt: nowIso() });
  return archived;
}

export async function archiveImportedDiagramComponent(context: PersistenceContext, componentId: string): Promise<DiagramComponentRecord> {
  const library = await loadImportedArtifactLibrary(context);
  if (!library.diagramComponentIds.includes(componentId)) {
    throw new Error(`unknown imported DiagramComponent: ${componentId}`);
  }
  const component = await loadImportedDiagramComponent(context, componentId);
  if (component.archivedAt) return component;
  const archived = { ...component, archivedAt: nowIso() };
  await writeJsonAtomic(importedDiagramComponentPath(context, componentId), archived);
  await saveImportedArtifactLibrary(context, { ...library, updatedAt: nowIso() });
  return archived;
}

export async function migrateLegacyImports(context: PersistenceContext, diagramSets: DiagramSetRecord[], initialLibrary: ImportedArtifactLibraryRecord): Promise<ImportedArtifactLibraryRecord> {
  const globalDiagrams = await Promise.all(
    initialLibrary.diagramIds.map((id) => loadImportedDiagram(context, id))
  );
  const globalComponents = await Promise.all(
    initialLibrary.diagramComponentIds.map((id) => loadImportedDiagramComponent(context, id))
  );
  const diagramHandles = new Set(globalDiagrams.map((diagram) => diagram.handle));
  const componentHandles = new Set(globalComponents.map((component) => component.handle));
  const diagramsBySet = new Map<string, DiagramRecord[]>();
  const componentsBySet = new Map<string, DiagramComponentRecord[]>();

  for (const set of diagramSets) {
    const diagrams = await Promise.all(set.diagramIds.map((id) => loadDiagram(context, set.id, id)));
    const components = await Promise.all(
      set.diagramComponentIds.map((id) => loadDiagramComponent(context, set.id, id))
    );
    diagramsBySet.set(set.id, diagrams);
    componentsBySet.set(set.id, components);
    for (const diagram of diagrams) {
      if (diagram.origin !== "imported") diagramHandles.add(diagram.handle);
    }
    for (const component of components) {
      if (component.origin !== "imported") componentHandles.add(component.handle);
    }
  }

  let library = initialLibrary;
  let changed = false;
  const migratedSets: DiagramSetRecord[] = [];
  const uniqueHandle = (requested: string, used: Set<string>): string => {
    const base = requested;
    let handle = base;
    let suffix = 2;
    while (used.has(handle)) handle = `${base}-${suffix++}`;
    used.add(handle);
    return handle;
  };

  for (const set of diagramSets) {
    const diagrams = diagramsBySet.get(set.id) ?? [];
    const components = componentsBySet.get(set.id) ?? [];
    const importedDiagrams = diagrams.filter((diagram) => diagram.origin === "imported");
    const importedComponents = components.filter((component) => component.origin === "imported");
    if (importedDiagrams.length === 0 && importedComponents.length === 0) continue;

    for (const diagram of importedDiagrams) {
      if (!library.diagramIds.includes(diagram.id)) {
        const migrated: DiagramRecord = {
          ...diagram,
          diagramSetId: GLOBAL_IMPORTS_DIAGRAM_SET_ID,
          handle: uniqueHandle(diagram.handle, diagramHandles),
          codeEntityIds: []
        };
        await writeJsonAtomic(importedDiagramPath(context, migrated.id), migrated);
        library = { ...library, diagramIds: [...library.diagramIds, migrated.id] };
      }
    }
    for (const component of importedComponents) {
      if (!library.diagramComponentIds.includes(component.id)) {
        const migrated: DiagramComponentRecord = {
          ...component,
          diagramSetId: GLOBAL_IMPORTS_DIAGRAM_SET_ID,
          handle: uniqueHandle(component.handle, componentHandles),
          codeEntityIds: []
        };
        await writeJsonAtomic(importedDiagramComponentPath(context, migrated.id), migrated);
        library = {
          ...library,
          diagramComponentIds: [...library.diagramComponentIds, migrated.id]
        };
      }
    }
    migratedSets.push({
      ...set,
      diagramIds: diagrams
        .filter((diagram) => diagram.origin !== "imported")
        .map((diagram) => diagram.id),
      diagramComponentIds: components
        .filter((component) => component.origin !== "imported")
        .map((component) => component.id),
      updatedAt: nowIso()
    });
    changed = true;
  }

  if (!changed) return library;
  const migrated = { ...library, updatedAt: nowIso() };
  await saveImportedArtifactLibrary(context, migrated);
  for (const set of migratedSets) await writeJsonAtomic(setPath(context, set.id), set);
  return migrated;
}
