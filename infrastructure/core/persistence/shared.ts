import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { RepositoryLocation } from "../../../application/core/corpus/location";
import { type HighlightRecordV2 } from "../../../domain/core/highlights/highlights";
import type { BuiltInDomainProfileId } from "../../../domain/core/profiles/domainProfile";
import {
  SCHEMA_VERSION,
  type DiagramHighlightRecord,
  type DiagramRecord,
  type PlanChange,
  type PlanCodeEntityCompactionChange,
  type PlanModifiedDiagramChange,
  type PlanRecord,
  type ProjectRecord
} from "../../../domain/core/records/domain";

export type PersistedHighlight = DiagramHighlightRecord | HighlightRecordV2;

export interface PersistedPlanChangeReference {
  id: string;
  kind: PlanChange["kind"];
  mode?: "partial" | "complete";
  path: string;
}

export type PersistedPlanManifest = Omit<PlanRecord, "markdown" | "selection" | "changes"> & {
  markdownPath: "plan.md";
  selectionPath: "selection.json";
  changes: PersistedPlanChangeReference[];
};

export type PersistedModifiedDiagramChange = Omit<
  PlanModifiedDiagramChange,
  "baseDiagram" | "outputAscii" | "semanticDiff"
> & {
  schemaVersion: typeof SCHEMA_VERSION;
  baseDiagram: Omit<DiagramRecord, "ascii">;
  basePath: "base.txt";
  outputPath: "output.txt";
  semanticDiffPath?: "semantic-diff.json";
};

export interface PersistedCompactionArtifact {
  schemaVersion: typeof SCHEMA_VERSION;
  compactedSource: PlanCodeEntityCompactionChange["compactedSource"] | null;
}

export const execFileAsync = promisify(execFile);

export async function discoverRepository(inputPath: string): Promise<RepositoryLocation> {
  const resolved = path.resolve(inputPath);
  const info = await stat(resolved).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`repository path is not a directory: ${resolved}`);
  const git = async (...args: string[]) => {
    const result = await execFileAsync("git", ["-C", resolved, ...args], { encoding: "utf8" });
    return result.stdout.trim();
  };
  const checkoutRoot = path.resolve(await git("rev-parse", "--show-toplevel"));
  const commonDirRaw = await git("rev-parse", "--git-common-dir");
  const repositoryIdentity = path.resolve(checkoutRoot, commonDirRaw);
  const gitRevision = await git("rev-parse", "HEAD").catch(() => undefined);
  return {
    checkoutRoot,
    repositoryIdentity,
    gitRevision,
    domainProfileId: "source-code",
    corpus: { kind: "git-worktree", root: checkoutRoot, ...(gitRevision ? { revision: gitRevision } : {}) }
  };
}

export async function discoverDocumentCorpus(inputPath: string): Promise<RepositoryLocation> {
  const resolved = path.resolve(inputPath);
  const info = await stat(resolved).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`document corpus path is not a directory: ${resolved}`);
  const checkoutRoot = await realpath(resolved);
  return {
    checkoutRoot,
    repositoryIdentity: `filesystem-documents:${checkoutRoot}`,
    domainProfileId: "document",
    corpus: { kind: "filesystem-documents", root: checkoutRoot }
  };
}

export async function discoverDomainCorpus(
  inputPath: string,
  domainProfileId: BuiltInDomainProfileId
): Promise<RepositoryLocation> {
  return domainProfileId === "document"
    ? discoverDocumentCorpus(inputPath)
    : discoverRepository(inputPath);
}

export function projectIdFor(repositoryIdentity: string): string {
  const digest = createHash("sha256").update(repositoryIdentity).digest("hex").slice(0, 12);
  return `project-${digest}`;
}

export function normalizedProject(project: ProjectRecord): ProjectRecord { return project; }

export function nowIso(): string {
  return new Date().toISOString();
}

export function makeId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

export function stableScopedId(prefix: string, ...parts: string[]): string {
  const digest = createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 32);
  return `${prefix}-${digest}`;
}

export async function readJson<T>(filePath: string): Promise<T> {
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as T & { schemaVersion?: number };
  if (parsed.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`unsupported schema in ${filePath}`);
  }
  return parsed;
}

export async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    return await readJson<T>(filePath);
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
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}
