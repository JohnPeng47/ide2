import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CompactionSnapshot } from "../../../../domain/core/representations/compactionProjection";
import type { FileCompactionResult, FileCompactionStage } from "../../../../domain/mapping/compaction/fileCompaction";
import type { FileCompactionPrompts } from "./fileCompactionWorkflow";
import type { FileCompactionAgentSettings } from "./fileCompactionSettings";

export interface FileCompactionRun {
  schemaVersion: 1;
  id: string;
  projectId: string;
  sourceFile: string;
  sourceSha256: string;
  workflowId: "single-file-compaction";
  status: "running" | "completed" | "failed" | "cancelled" | "interrupted";
  stage: FileCompactionStage;
  createdAt: string;
  updatedAt: string;
  prompts: FileCompactionPrompts;
  /** Absent on historical runs created before per-request agent settings. */
  agent?: FileCompactionAgentSettings;
  steps: Partial<Record<FileCompactionStage, { prompt: string; model?: string; sessionId?: string; snapshot?: CompactionSnapshot }>>;
  result?: FileCompactionResult;
  error?: string;
}

export class FileCompactionStore {
  constructor(private readonly root: string) {}

  directory(id: string): string {
    if (!/^compaction-[0-9a-f-]{36}$/.test(id)) throw new Error("Invalid compaction run id");
    return path.join(this.root, "mapping", "compactions", id);
  }

  async create(run: FileCompactionRun, source: Buffer): Promise<void> {
    await mkdir(this.directory(run.id), { recursive: true });
    await writeFile(path.join(this.directory(run.id), "source.txt"), source, { flag: "wx" });
    await this.save(run);
  }

  async save(run: FileCompactionRun): Promise<void> {
    run.updatedAt = new Date().toISOString();
    const file = path.join(this.directory(run.id), "run.json");
    const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(run, null, 2) + "\n");
    await rename(temporary, file);
  }

  async load(id: string): Promise<FileCompactionRun | null> {
    try { return JSON.parse(await readFile(path.join(this.directory(id), "run.json"), "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }

  artifacts(id: string): FileCompactionResult["artifacts"] {
    const base = path.relative(this.root, this.directory(id)).split(path.sep).join("/");
    return { compact: { text: `${base}/compact.txt`, mappings: `${base}/compact.json` },
      refine: { text: `${base}/refine.txt`, mappings: `${base}/refine.json` } };
  }

  async savePass(id: string, stage: FileCompactionStage, snapshot: CompactionSnapshot): Promise<void> {
    const directory = this.directory(id);
    await writeFile(path.join(directory, `${stage}.txt`), snapshot.ascii, { flag: "wx" });
    await writeFile(path.join(directory, `${stage}.json`), JSON.stringify({
      sourceFile: snapshot.sourceFile, sourceSha256: snapshot.sourceSha256,
      treeFile: `${stage}.txt`, mappings: snapshot.mappings
    }, null, 2) + "\n", { flag: "wx" });
  }
}
