#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ENTITY_ID_PATTERN = /^entity-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RANGE_ID_PATTERN = /^range-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENTITY_ARRAY_KEYS = new Set([
  "codeEntityIds",
  "selectedCodeEntityIds",
  "outputCodeEntityIds",
]);

function usage() {
  return [
    "Usage: node scripts/migrations/relabel-code-entity-identities.mjs <.diagrams-root> [--apply]",
    "",
    "Without --apply the command performs an in-memory migration and validates it.",
    "With --apply it first copies the complete persistence root to a timestamped",
    "sibling under .diagrams-backups, then atomically rewrites changed active-set files.",
  ].join("\n");
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function jsonFiles(root) {
  const results = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(entryPath);
      else if (entry.isFile() && entry.name.endsWith(".json")) results.push(entryPath);
    }
  }
  await walk(root);
  return results.sort();
}

function originKey(origin, entityId) {
  return `${origin.projectId}\u0000${origin.diagramSetId}\u0000${origin.codeEntitiesSetId}\u0000${entityId}`;
}

function timestamp() {
  return new Date().toISOString().replaceAll(":", "-").replace(".", "-");
}

function clone(value) {
  return structuredClone(value);
}

function findDescriptor(context, entityId, explicitOrigin) {
  if (explicitOrigin?.projectId && explicitOrigin?.diagramSetId && explicitOrigin?.codeEntitiesSetId) {
    return context.byQualifiedOldId.get(originKey(explicitOrigin, entityId))
      ?? context.byQualifiedNewId.get(originKey(explicitOrigin, entityId));
  }
  return context.localByOldId.get(entityId) ?? context.localByNewId.get(entityId);
}

function sourceRangeFor(descriptor, sourceRangeId, sourceRangeIndex) {
  if (typeof sourceRangeId === "string") {
    const byOldId = descriptor.rangesByOldId.get(sourceRangeId);
    if (byOldId) return byOldId;
    const byNewId = descriptor.ranges.find((range) => range.newId === sourceRangeId);
    if (byNewId) return byNewId;
  }
  if (Number.isInteger(sourceRangeIndex)) return descriptor.ranges[sourceRangeIndex];
  return undefined;
}

function transformObject(value, context, stats) {
  if (Array.isArray(value)) return value.map((item) => transformObject(item, context, stats));
  if (value === null || typeof value !== "object") return value;

  const result = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = transformObject(child, context, stats);
  }

  if (result.kind === "code-entity" && typeof result.targetId === "string") {
    const descriptor = findDescriptor(context, result.targetId, result.origin);
    if (!descriptor) {
      throw new Error(`Unresolved CodeEntity reference ${result.targetId} in ${context.relativeFile}`);
    }
    if (result.targetId !== descriptor.newId) stats.referenceIds += 1;
    result.targetId = descriptor.newId;
    result.origin = descriptor.origin;
    const range = sourceRangeFor(descriptor, result.sourceRangeId, result.sourceRangeIndex);
    if (result.sourceRangeId !== undefined || result.sourceRangeIndex !== undefined) {
      if (!range) {
        throw new Error(`Unresolved source range on ${descriptor.oldId} in ${context.relativeFile}`);
      }
      if (result.sourceRangeId !== range.newId) stats.rangeReferences += 1;
      result.sourceRangeId = range.newId;
    }
  }

  if (typeof result.entityId === "string") {
    const descriptor = findDescriptor(context, result.entityId, result.origin);
    if (!descriptor) {
      throw new Error(`Unresolved mapping CodeEntity ${result.entityId} in ${context.relativeFile}`);
    }
    if (result.entityId !== descriptor.newId) stats.referenceIds += 1;
    result.entityId = descriptor.newId;
    const range = sourceRangeFor(descriptor, result.sourceRangeId, result.sourceRangeIndex);
    if (result.sourceRangeId !== undefined || result.sourceRangeIndex !== undefined) {
      if (!range) {
        throw new Error(`Unresolved mapping range on ${descriptor.oldId} in ${context.relativeFile}`);
      }
      if (result.sourceRangeId !== range.newId) stats.rangeReferences += 1;
      result.sourceRangeId = range.newId;
    }
  }

  for (const key of ENTITY_ARRAY_KEYS) {
    if (!Array.isArray(result[key])) continue;
    result[key] = result[key].map((entityId) => {
      if (typeof entityId !== "string") return entityId;
      const descriptor = findDescriptor(context, entityId);
      if (!descriptor) {
        throw new Error(`Unresolved ${key} entry ${entityId} in ${context.relativeFile}`);
      }
      if (entityId !== descriptor.newId) stats.referenceIds += 1;
      return descriptor.newId;
    });
  }

  return result;
}

function collectExactStrings(value, location = "$", found = []) {
  if (typeof value === "string") {
    found.push([location, value]);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => collectExactStrings(item, `${location}[${index}]`, found));
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      collectExactStrings(child, `${location}.${key}`, found);
    }
  }
  return found;
}

function validateMigratedSet(setPlan, allDescriptors) {
  const entityIds = new Set();
  const rangeIds = new Set();
  const local = new Map(setPlan.descriptors.map((descriptor) => [descriptor.newId, descriptor]));
  const qualified = new Map(allDescriptors.map((descriptor) => [originKey(descriptor.origin, descriptor.newId), descriptor]));

  for (const descriptor of setPlan.descriptors) {
    if (!ENTITY_ID_PATTERN.test(descriptor.newId)) throw new Error(`Invalid migrated entity id: ${descriptor.newId}`);
    if (entityIds.has(descriptor.newId)) throw new Error(`Duplicate entity id: ${descriptor.newId}`);
    entityIds.add(descriptor.newId);
    for (const range of descriptor.ranges) {
      if (!RANGE_ID_PATTERN.test(range.newId)) throw new Error(`Invalid migrated range id: ${range.newId}`);
      if (rangeIds.has(range.newId)) throw new Error(`Duplicate range id in ${setPlan.setId}: ${range.newId}`);
      rangeIds.add(range.newId);
    }
  }

  function resolve(entityId, origin) {
    if (origin?.projectId && origin?.diagramSetId && origin?.codeEntitiesSetId) {
      return qualified.get(originKey(origin, entityId));
    }
    return local.get(entityId);
  }

  function visit(value, file) {
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, file));
      return;
    }
    if (!value || typeof value !== "object") return;

    if (value.kind === "code-entity" && typeof value.targetId === "string") {
      const descriptor = resolve(value.targetId, value.origin);
      if (!descriptor) throw new Error(`Post-migration unresolved reference ${value.targetId} in ${file}`);
      if (value.origin.projectId !== descriptor.origin.projectId
        || value.origin.diagramSetId !== descriptor.origin.diagramSetId
        || value.origin.codeEntitiesSetId !== descriptor.origin.codeEntitiesSetId) {
        throw new Error(`Incorrect reference origin for ${value.targetId} in ${file}`);
      }
      if (value.sourceRangeId !== undefined
        && !descriptor.ranges.some((range) => range.newId === value.sourceRangeId)) {
        throw new Error(`Post-migration unresolved range ${value.sourceRangeId} in ${file}`);
      }
    }

    if (typeof value.entityId === "string") {
      const descriptor = resolve(value.entityId, value.origin);
      if (!descriptor) throw new Error(`Post-migration unresolved map entity ${value.entityId} in ${file}`);
      if (value.sourceRangeId !== undefined
        && !descriptor.ranges.some((range) => range.newId === value.sourceRangeId)) {
        throw new Error(`Post-migration unresolved map range ${value.sourceRangeId} in ${file}`);
      }
    }

    for (const key of ENTITY_ARRAY_KEYS) {
      if (!Array.isArray(value[key])) continue;
      for (const entityId of value[key]) {
        if (!resolve(entityId)) throw new Error(`Post-migration unresolved ${key} entry ${entityId} in ${file}`);
      }
    }
    Object.values(value).forEach((child) => visit(child, file));
  }

  for (const file of setPlan.files) visit(file.after, file.relativeFile);
}

async function buildPlan(root) {
  const project = await readJson(path.join(root, "project.json"));
  const activeSetIds = project.diagramSetIds;
  const setPlans = [];
  const allDescriptors = [];
  const byQualifiedOldId = new Map();
  const byQualifiedNewId = new Map();

  for (const setId of activeSetIds) {
    const setRoot = path.join(root, "diagram-sets", setId);
    const diagramSet = await readJson(path.join(setRoot, "diagram-set.json"));
    const entitiesPath = path.join(setRoot, "code-entities.json");
    const codeEntitySet = await readJson(entitiesPath);
    if (diagramSet.projectId !== project.id || codeEntitySet.diagramSetId !== setId
      || diagramSet.codeEntitiesSetId !== codeEntitySet.id) {
      throw new Error(`Ownership mismatch in ${setId}`);
    }
    const seenOldIds = new Set();
    const descriptors = codeEntitySet.entities.map((entity) => {
      if (seenOldIds.has(entity.id)) throw new Error(`Duplicate legacy entity id ${entity.id} in ${setId}`);
      seenOldIds.add(entity.id);
      const origin = {
        projectId: project.id,
        diagramSetId: setId,
        codeEntitiesSetId: codeEntitySet.id,
      };
      const descriptor = {
        oldId: entity.id,
        newId: ENTITY_ID_PATTERN.test(entity.id) ? entity.id : `entity-${randomUUID()}`,
        origin,
        ranges: entity.sourceRanges.map((range, index) => ({
          index,
          oldId: range.id,
          newId: typeof range.id === "string" && RANGE_ID_PATTERN.test(range.id)
            ? range.id
            : `range-${randomUUID()}`,
        })),
      };
      descriptor.rangesByOldId = new Map(
        descriptor.ranges.filter((range) => range.oldId).map((range) => [range.oldId, range]),
      );
      byQualifiedOldId.set(originKey(origin, descriptor.oldId), descriptor);
      byQualifiedNewId.set(originKey(origin, descriptor.newId), descriptor);
      allDescriptors.push(descriptor);
      return descriptor;
    });
    setPlans.push({ setId, setRoot, diagramSet, codeEntitySet, entitiesPath, descriptors, files: [] });
  }

  const stats = { entityIds: 0, rangeIds: 0, referenceIds: 0, rangeReferences: 0 };
  for (const setPlan of setPlans) {
    const localByOldId = new Map(setPlan.descriptors.map((descriptor) => [descriptor.oldId, descriptor]));
    const localByNewId = new Map(setPlan.descriptors.map((descriptor) => [descriptor.newId, descriptor]));
    const files = await jsonFiles(setPlan.setRoot);
    for (const filePath of files) {
      const before = await readJson(filePath);
      const relativeFile = path.relative(root, filePath);
      let after;
      if (filePath === setPlan.entitiesPath) {
        after = clone(before);
        after.entities = after.entities.map((entity, index) => {
          const descriptor = setPlan.descriptors[index];
          const migrated = { ...entity, id: descriptor.newId, origin: descriptor.origin };
          if (entity.id !== descriptor.newId) stats.entityIds += 1;
          migrated.sourceRanges = entity.sourceRanges.map((range, rangeIndex) => {
            const newId = descriptor.ranges[rangeIndex].newId;
            if (range.id !== newId) stats.rangeIds += 1;
            return { ...range, id: newId };
          });
          return migrated;
        });
      } else {
        after = transformObject(before, {
          relativeFile,
          localByOldId,
          localByNewId,
          byQualifiedOldId,
          byQualifiedNewId,
        }, stats);
      }
      setPlan.files.push({ path: filePath, relativeFile, before, after });
    }
  }

  const oldIds = new Set(allDescriptors.filter((descriptor) => descriptor.oldId !== descriptor.newId)
    .map((descriptor) => descriptor.oldId));
  for (const setPlan of setPlans) {
    for (const file of setPlan.files) {
      for (const [location, value] of collectExactStrings(file.after)) {
        if (oldIds.has(value)) {
          throw new Error(`Legacy entity id remains at ${file.relativeFile}:${location}: ${value}`);
        }
      }
    }
    validateMigratedSet(setPlan, allDescriptors);
  }

  const globalEntityIds = new Set();
  const globalRangeIds = new Set();
  for (const descriptor of allDescriptors) {
    if (globalEntityIds.has(descriptor.newId)) throw new Error(`Global entity id collision: ${descriptor.newId}`);
    globalEntityIds.add(descriptor.newId);
    for (const range of descriptor.ranges) {
      if (globalRangeIds.has(range.newId)) throw new Error(`Global source-range id collision: ${range.newId}`);
      globalRangeIds.add(range.newId);
    }
  }

  const changedFiles = setPlans.flatMap((setPlan) => setPlan.files)
    .filter((file) => JSON.stringify(file.before) !== JSON.stringify(file.after));
  return { project, setPlans, allDescriptors, stats, changedFiles };
}

async function atomicWriteJson(filePath, value) {
  const temporaryPath = `${filePath}.relabel-${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

async function applyPlan(root, plan) {
  const backupBase = path.join(path.dirname(root), ".diagrams-backups");
  const backupPath = path.join(backupBase, `code-entity-relabel-${timestamp()}`);
  await mkdir(backupBase, { recursive: true });
  await cp(root, backupPath, { recursive: true, errorOnExist: true, force: false });
  for (const file of plan.changedFiles) await atomicWriteJson(file.path, file.after);
  return backupPath;
}

function report(root, plan, mode, backupPath) {
  const mappingPreview = plan.allDescriptors.slice(0, 8).map((descriptor) => ({
    setId: descriptor.origin.diagramSetId,
    oldId: descriptor.oldId,
    newId: descriptor.newId,
  }));
  const reportValue = {
    mode,
    root,
    backupPath: backupPath ?? null,
    activeDiagramSets: plan.setPlans.length,
    entitiesInventoried: plan.allDescriptors.length,
    sourceRangesInventoried: plan.allDescriptors.reduce((sum, descriptor) => sum + descriptor.ranges.length, 0),
    entityIdsRelabeled: plan.stats.entityIds,
    sourceRangeIdsRelabeled: plan.stats.rangeIds,
    entityReferencesRelabeled: plan.stats.referenceIds,
    sourceRangeReferencesAddedOrRelabeled: plan.stats.rangeReferences,
    changedFiles: plan.changedFiles.map((file) => file.relativeFile),
    mappingPreview,
    integrity: "passed",
    excluded: ["trash/ (recoverable deleted DiagramSets)"],
  };
  console.log(JSON.stringify(reportValue, null, 2));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    console.log(usage());
    process.exitCode = args.length === 0 ? 1 : 0;
    return;
  }
  const rootArgument = args.find((arg) => !arg.startsWith("--"));
  const apply = args.includes("--apply");
  const root = path.resolve(rootArgument);
  const plan = await buildPlan(root);
  if (!apply) {
    report(root, plan, "dry-run", undefined);
    return;
  }
  const backupPath = await applyPlan(root, plan);
  const verification = await buildPlan(root);
  if (verification.changedFiles.length !== 0) {
    throw new Error(`Migration was not idempotent: ${verification.changedFiles.length} files would still change`);
  }
  report(root, plan, "applied", backupPath);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
