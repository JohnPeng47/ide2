#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GLOBAL_IMPORTS = "global-imports";
const KINDS = ["diagram", "diagram-component"];
const GLOBAL_ID = {
  diagram: /^diagram-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  "diagram-component": /^component-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
};

function usage() {
  return [
    "Usage: node scripts/relabel-artifact-ids.mjs --store PATH [--apply] [--exclude-trash]",
    "",
    "Dry-run is the default. Apply mode validates a staged copy, swaps it into place,",
    "and retains the original store beside it as a timestamped backup."
  ].join("\n");
}

function parseArgs(argv) {
  let store;
  let apply = false;
  let includeTrash = true;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--store") store = argv[++index];
    else if (arg === "--apply") apply = true;
    else if (arg === "--exclude-trash") includeTrash = false;
    else if (arg === "--help" || arg === "-h") return { help: true };
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!store) throw new Error("--store is required");
  return { store: path.resolve(store), apply, includeTrash, help: false };
}

async function walkJson(root, includeTrash) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!includeTrash && directory === root && entry.name === "trash") continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile() && entry.name.endsWith(".json")) files.push(absolute);
    }
  }
  await visit(root);
  return files.sort();
}

function artifactKindForPath(file) {
  const parent = path.basename(path.dirname(file));
  if (parent === "diagrams" && path.basename(file).startsWith("diagram-")) return "diagram";
  if (parent === "diagram-components" && path.basename(file).startsWith("component-")) {
    return "diagram-component";
  }
  return undefined;
}

function sameOrigin(left, right) {
  return left.projectId === right.projectId && left.diagramSetId === right.diagramSetId;
}

function originKey(origin) {
  return `${origin.projectId}\0${origin.diagramSetId}`;
}

function groupKey(kind, id) {
  return `${kind}\0${id}`;
}

function createId(kind) {
  return `${kind === "diagram" ? "diagram" : "component"}-${randomUUID()}`;
}

async function loadStore(root, includeTrash) {
  const rootInfo = await stat(root).catch(() => undefined);
  if (!rootInfo?.isDirectory()) throw new Error(`store is not a directory: ${root}`);
  const files = await walkJson(root, includeTrash);
  const documents = new Map();
  for (const file of files) {
    try {
      documents.set(file, JSON.parse(await readFile(file, "utf8")));
    } catch (error) {
      throw new Error(`cannot parse ${file}: ${error.message}`);
    }
  }
  const project = documents.get(path.join(root, "project.json"));
  if (!project || typeof project.id !== "string") throw new Error("project.json has no project id");
  return { documents, projectId: project.id };
}

function inventoryArtifacts(documents, projectId) {
  const artifacts = [];
  const groups = new Map();
  for (const [file, value] of documents) {
    const kind = artifactKindForPath(file);
    if (!kind) continue;
    if (!value || typeof value !== "object" || typeof value.id !== "string") {
      throw new Error(`invalid artifact record: ${file}`);
    }
    if (path.basename(file) !== `${value.id}.json`) {
      throw new Error(`artifact id/file mismatch: ${file} contains ${value.id}`);
    }
    const artifact = { file, kind, value, oldId: value.id };
    artifacts.push(artifact);
    const key = groupKey(kind, value.id);
    const group = groups.get(key) ?? { kind, oldId: value.id, artifacts: [] };
    group.artifacts.push(artifact);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    const explicitOrigins = group.artifacts
      .map(({ value }) => value.recordOrigin)
      .filter((origin) => origin && typeof origin.projectId === "string"
        && typeof origin.diagramSetId === "string");
    const distinctExplicit = new Map(explicitOrigins.map((origin) => [originKey(origin), origin]));
    if (distinctExplicit.size > 1) {
      throw new Error(`conflicting provenance for ${group.kind} ${group.oldId}`);
    }

    let origin = distinctExplicit.values().next().value;
    if (!origin) {
      const localOrigins = new Map();
      for (const { value } of group.artifacts) {
        if (typeof value.diagramSetId === "string" && value.diagramSetId !== GLOBAL_IMPORTS) {
          const candidate = { projectId, diagramSetId: value.diagramSetId };
          localOrigins.set(originKey(candidate), candidate);
        }
      }
      if (localOrigins.size > 1) {
        throw new Error(
          `ambiguous legacy collision for ${group.kind} ${group.oldId}: ${[
            ...localOrigins.values()
          ].map((item) => item.diagramSetId).join(", ")}`
        );
      }
      origin = localOrigins.values().next().value ?? { projectId, diagramSetId: GLOBAL_IMPORTS };
    }
    group.origin = origin;
    group.newId = GLOBAL_ID[group.kind].test(group.oldId) ? group.oldId : createId(group.kind);
  }
  return { artifacts, groups };
}

function transformStore(documents, projectId, plannedIds = undefined) {
  const { artifacts, groups } = inventoryArtifacts(documents, projectId);
  if (plannedIds) {
    for (const group of groups.values()) {
      const plannedId = plannedIds.get(groupKey(group.kind, group.oldId));
      if (!plannedId) throw new Error(`missing planned id for ${group.kind} ${group.oldId}`);
      group.newId = plannedId;
    }
  }
  const byKind = Object.fromEntries(KINDS.map((kind) => [kind, new Map()]));
  for (const group of groups.values()) byKind[group.kind].set(group.oldId, group);
  const changedFiles = new Set();
  let referencesUpdated = 0;
  let originsAdded = 0;

  function resolve(kind, oldId, context) {
    if (typeof oldId !== "string") return oldId;
    const group = byKind[kind].get(oldId);
    if (!group) throw new Error(`dangling ${kind} reference ${oldId} at ${context}`);
    return group.newId;
  }

  function resolveAny(oldId, context) {
    if (typeof oldId !== "string") return oldId;
    const matches = KINDS.map((kind) => byKind[kind].get(oldId)).filter(Boolean);
    if (matches.length !== 1) {
      throw new Error(`${matches.length ? "ambiguous" : "dangling"} artifact reference ${oldId} at ${context}`);
    }
    return matches[0].newId;
  }

  function updateArray(object, key, kind, context) {
    if (!Array.isArray(object[key])) return;
    object[key] = object[key].map((id, index) => resolve(kind, id, `${context}.${key}[${index}]`));
  }

  function visit(value, context) {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${context}[${index}]`));
      return;
    }
    if (!value || typeof value !== "object") return;

    if ((value.kind === "diagram" || value.kind === "diagram-component")
      && typeof value.targetId === "string") {
      const group = byKind[value.kind].get(value.targetId);
      const oldTargetId = value.targetId;
      value.targetId = resolve(value.kind, oldTargetId, `${context}.targetId`);
      if (oldTargetId !== value.targetId) referencesUpdated += 1;
      if (!value.origin) {
        value.origin = { ...group.origin };
        originsAdded += 1;
      } else if (!sameOrigin(value.origin, group.origin)) {
        throw new Error(`reference origin mismatch at ${context}`);
      }
    }
    if ((value.sourceArtifactKind === "diagram" || value.sourceArtifactKind === "diagram-component")
      && typeof value.sourceArtifactId === "string") {
      const group = byKind[value.sourceArtifactKind].get(value.sourceArtifactId);
      value.sourceArtifactId = resolve(
        value.sourceArtifactKind,
        value.sourceArtifactId,
        `${context}.sourceArtifactId`
      );
      if (Object.hasOwn(value, "promptCorrection") && !value.sourceArtifactOrigin) {
        value.sourceArtifactOrigin = { ...group.origin };
        originsAdded += 1;
      } else if (Object.hasOwn(value, "promptCorrection")
        && !sameOrigin(value.sourceArtifactOrigin, group.origin)) {
        throw new Error(`derivation origin mismatch at ${context}`);
      }
      if (typeof value.outputArtifactId === "string") {
        value.outputArtifactId = resolve(
          value.sourceArtifactKind,
          value.outputArtifactId,
          `${context}.outputArtifactId`
        );
      }
    }
    if ((value.artifactKind === "diagram" || value.artifactKind === "diagram-component")
      && typeof value.artifactId === "string") {
      value.artifactId = resolve(value.artifactKind, value.artifactId, `${context}.artifactId`);
    }

    updateArray(value, "diagramIds", "diagram", context);
    updateArray(value, "outputDiagramIds", "diagram", context);
    updateArray(value, "derivedFromDiagramIds", "diagram", context);
    updateArray(value, "diagramComponentIds", "diagram-component", context);
    updateArray(value, "outputDiagramComponentIds", "diagram-component", context);
    updateArray(value, "derivedFromDiagramComponentIds", "diagram-component", context);
    if (Array.isArray(value.codeEntityMapArtifactIds)) {
      value.codeEntityMapArtifactIds = value.codeEntityMapArtifactIds.map(
        (id, index) => resolveAny(id, `${context}.codeEntityMapArtifactIds[${index}]`)
      );
    }
    for (const key of ["basedOnDiagramId", "sourceDiagramId", "outputDiagramId"]) {
      if (typeof value[key] === "string") value[key] = resolve("diagram", value[key], `${context}.${key}`);
    }
    for (const key of ["sourceDiagramComponentId", "outputDiagramComponentId"]) {
      if (typeof value[key] === "string") {
        value[key] = resolve("diagram-component", value[key], `${context}.${key}`);
      }
    }
    if (value.featuredViewIds && typeof value.featuredViewIds === "object") {
      for (const [viewKind, id] of Object.entries(value.featuredViewIds)) {
        value.featuredViewIds[viewKind] = resolve("diagram", id, `${context}.featuredViewIds.${viewKind}`);
      }
    }

    for (const [key, child] of Object.entries(value)) {
      if (key !== "recordOrigin" && key !== "origin" && key !== "sourceArtifactOrigin") {
        visit(child, `${context}.${key}`);
      }
    }
  }

  for (const [file, value] of documents) {
    const before = JSON.stringify(value);
    visit(value, path.relative(process.cwd(), file));
    if (before !== JSON.stringify(value)) changedFiles.add(file);
  }

  for (const artifact of artifacts) {
    const group = groups.get(groupKey(artifact.kind, artifact.oldId));
    artifact.value.id = group.newId;
    if (!artifact.value.recordOrigin) {
      artifact.value.recordOrigin = { ...group.origin };
      originsAdded += 1;
      changedFiles.add(artifact.file);
    }
    if (artifact.oldId !== group.newId) changedFiles.add(artifact.file);
  }

  const artifactRenames = artifacts
    .filter((artifact) => artifact.oldId !== groups.get(groupKey(artifact.kind, artifact.oldId)).newId)
    .map((artifact) => ({
      from: artifact.file,
      to: path.join(
        path.dirname(artifact.file),
        `${groups.get(groupKey(artifact.kind, artifact.oldId)).newId}.json`
      )
    }));
  const mapRenames = [...documents]
    .filter(([file, value]) => path.basename(path.dirname(file)) === "code-entity-maps"
      && (value?.artifactKind === "diagram" || value?.artifactKind === "diagram-component"))
    .map(([file, value]) => {
      const oldId = path.basename(file, ".json");
      const newId = resolve(value.artifactKind, oldId, `${file} filename`);
      return { from: file, to: path.join(path.dirname(file), `${newId}.json`) };
    })
    .filter(({ from, to }) => from !== to);
  const renames = [...artifactRenames, ...mapRenames];
  for (const [file, value] of documents) {
    if (changedFiles.has(file) || artifacts.some((artifact) => artifact.file === file)) {
      documents.set(file, value);
    }
  }
  return {
    artifacts,
    groups,
    renames,
    changedFiles,
    referencesUpdated,
    originsAdded,
    resolve
  };
}

function validateMigration(documents, migration) {
  const errors = [];
  const ids = new Set();
  for (const artifact of migration.artifacts) {
    const { id, recordOrigin } = artifact.value;
    if (!GLOBAL_ID[artifact.kind].test(id)) errors.push(`non-global id ${id}`);
    if (!recordOrigin?.projectId || !recordOrigin?.diagramSetId) errors.push(`missing origin on ${id}`);
    const key = groupKey(artifact.kind, id);
    const oldGroup = migration.groups.get(groupKey(artifact.kind, artifact.oldId));
    if (ids.has(key) && oldGroup.artifacts.length === 1) errors.push(`duplicate id ${id}`);
    ids.add(key);
  }
  for (const group of migration.groups.values()) {
    for (const artifact of group.artifacts) {
      if (artifact.value.id !== group.newId) errors.push(`split duplicate identity ${group.oldId}`);
      if (!sameOrigin(artifact.value.recordOrigin, group.origin)) {
        errors.push(`origin mismatch for ${artifact.value.id}`);
      }
    }
  }
  const destinations = new Set();
  for (const item of migration.renames) {
    if (destinations.has(item.to)) errors.push(`duplicate destination ${item.to}`);
    destinations.add(item.to);
  }
  function validateReferences(value, context) {
    if (Array.isArray(value)) {
      value.forEach((item, index) => validateReferences(item, `${context}[${index}]`));
      return;
    }
    if (!value || typeof value !== "object") return;
    if ((value.kind === "diagram" || value.kind === "diagram-component")
      && typeof value.targetId === "string") {
      if (!GLOBAL_ID[value.kind].test(value.targetId)) errors.push(`non-global target at ${context}`);
      if (!value.origin?.projectId || !value.origin?.diagramSetId) {
        errors.push(`missing reference origin at ${context}`);
      }
    }
    if ((value.sourceArtifactKind === "diagram" || value.sourceArtifactKind === "diagram-component")
      && typeof value.sourceArtifactId === "string") {
      if (!GLOBAL_ID[value.sourceArtifactKind].test(value.sourceArtifactId)) {
        errors.push(`non-global source artifact at ${context}`);
      }
      if (Object.hasOwn(value, "promptCorrection")
        && (!value.sourceArtifactOrigin?.projectId || !value.sourceArtifactOrigin?.diagramSetId)) {
        errors.push(`missing derivation origin at ${context}`);
      }
    }
    for (const child of Object.values(value)) validateReferences(child, context);
  }
  for (const [file, value] of documents) validateReferences(value, file);
  if (errors.length) throw new Error(`migration validation failed:\n- ${errors.join("\n- ")}`);
  return {
    artifacts: migration.artifacts.length,
    logicalArtifacts: migration.groups.size,
    duplicateCopies: migration.artifacts.length - migration.groups.size,
    diagrams: migration.artifacts.filter((item) => item.kind === "diagram").length,
    diagramComponents: migration.artifacts.filter((item) => item.kind === "diagram-component").length,
    relabeledLogicalArtifacts: [...migration.groups.values()].filter((group) => group.oldId !== group.newId).length,
    renamedFiles: migration.renames.length,
    changedFiles: migration.changedFiles.size,
    referencesUpdated: migration.referencesUpdated,
    originsAdded: migration.originsAdded
  };
}

async function writeTransformedStore(root, documents, migration) {
  const renameBySource = new Map(migration.renames.map((item) => [item.from, item.to]));
  for (const [file, value] of documents) {
    const destination = renameBySource.get(file) ?? file;
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    if (destination !== file) await rm(file);
  }
  return root;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function migrateArtifactIds({ store, apply = false, includeTrash = true }) {
  const loaded = await loadStore(store, includeTrash);
  const migration = transformStore(loaded.documents, loaded.projectId);
  const summary = validateMigration(loaded.documents, migration);
  if (!apply) return { mode: "dry-run", store, summary };

  const parent = path.dirname(store);
  const base = path.basename(store);
  const suffix = `${process.pid}-${randomUUID()}`;
  const staged = path.join(parent, `.${base}.artifact-id-stage-${suffix}`);
  const backup = path.join(parent, `${base}.artifact-id-backup-${timestamp()}`);
  await cp(store, staged, { recursive: true, errorOnExist: true });
  try {
    const stagedLoaded = await loadStore(staged, includeTrash);
    const plannedIds = new Map(
      [...migration.groups.values()].map((group) => [groupKey(group.kind, group.oldId), group.newId])
    );
    const stagedMigration = transformStore(stagedLoaded.documents, stagedLoaded.projectId, plannedIds);
    validateMigration(stagedLoaded.documents, stagedMigration);
    await writeTransformedStore(staged, stagedLoaded.documents, stagedMigration);
    const verification = await loadStore(staged, includeTrash);
    const verifyMigration = transformStore(verification.documents, verification.projectId);
    const verifySummary = validateMigration(verification.documents, verifyMigration);
    if (verifySummary.relabeledLogicalArtifacts !== 0) {
      throw new Error("staged store is not idempotent after migration");
    }
    await rename(store, backup);
    try {
      await rename(staged, store);
    } catch (error) {
      await rename(backup, store);
      throw error;
    }
    return { mode: "apply", store, backup, summary };
  } catch (error) {
    await rm(staged, { recursive: true, force: true });
    throw error;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const result = await migrateArtifactIds(options);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
