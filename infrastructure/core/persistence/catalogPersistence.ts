import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import {
  SCHEMA_VERSION
} from "../../../domain/core/records/domain";
import * as rules from '../../../domain/core/representations/catalogRules';

import type {
  ProjectCorpusCompactionCatalogRecord,
  ProjectRepresentationCatalogRecord
} from "../../../domain/core/representations/projectCatalog";

export function nowIso(): string {
  return new Date().toISOString();
}

export function stableId(prefix: string, ...parts: string[]): string {
  const digest = createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 32);
  return `${prefix}-${digest}`;
}

export async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as T & { schemaVersion?: number };
    if (parsed.schemaVersion !== SCHEMA_VERSION) throw new Error(`unsupported schema in ${filePath}`);
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
  );
  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(tempPath, filePath);
  } finally { await rm(tempPath, { force: true }); }
}

export function emptyCompactionCatalog(projectId: string): ProjectCorpusCompactionCatalogRecord {
  const timestamp = nowIso();
  return {
    schemaVersion: SCHEMA_VERSION,
    projectId,
    activeByPath: {},
    compactions: {},
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function emptyRepresentationCatalog(projectId: string): ProjectRepresentationCatalogRecord {
  const timestamp = nowIso();
  return {
    schemaVersion: SCHEMA_VERSION,
    projectId,
    activeByKind: {},
    representations: {},
    revisions: {},
    createdAt: timestamp,
    updatedAt: timestamp
  };
}


export function catalogEnvironment(): rules.CatalogEnvironment {
  return {
    timestamp: nowIso(), representationId: `representation-${randomUUID()}`, revisionId: `representation-revision-${randomUUID()}`,
    hash: value => createHash('sha256').update(value).digest('hex'), stableId
  };
}
