import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type {
  AddDiagramDatasetItemResult,
  DiagramDatasetCatalogSnapshot,
  DiagramDatasetItemRecord,
  DiagramDatasetItemSummary,
  DiagramDatasetSummary
} from "../src/datasetDomain";

interface DiagramDatasetRecord {
  schemaVersion: 1;
  id: string;
  name: string;
  items: DiagramDatasetItemRecord[];
  createdAt: string;
  updatedAt: string;
}

function assertId(value: string, label: string): void {
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(value)) throw new Error(`invalid ${label}: ${value}`);
}

function normalizeName(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("dataset name is required");
  const name = value.trim();
  if (name.length > 120) throw new Error("dataset name must be at most 120 characters");
  return name;
}

export function normalizeDatasetLabels(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("labels must be an array of strings");
  const labels = [...new Set(value.map((label) => {
    if (typeof label !== "string") throw new Error("labels must be strings");
    const normalized = label.trim();
    if (!normalized) throw new Error("labels cannot be blank");
    if (normalized.length > 100) throw new Error("labels must be at most 100 characters");
    return normalized;
  }))];
  if (labels.length > 20) throw new Error("a diagram can have at most 20 labels");
  return labels;
}

function summary(record: DiagramDatasetRecord): DiagramDatasetSummary {
  return {
    id: record.id,
    name: record.name,
    itemCount: record.items.length,
    items: record.items.map(({ ascii: _ascii, codeEntityIds: _ids, modelId: _model, promptConfigId: _promptId, testedPrompt: _prompt, ...item }) => item),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function sourceKey(item: DiagramDatasetItemRecord): string {
  const source = item.source;
  return `${source.catalogId}:${source.axisId}:${source.iteration}:${source.value.toFixed(6)}:${source.replicate}`;
}

export class DiagramDatasetStore {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private path(datasetId: string): string {
    assertId(datasetId, "dataset id");
    return join(this.root, datasetId, "dataset.json");
  }

  private async read(datasetId: string): Promise<DiagramDatasetRecord> {
    return JSON.parse(await readFile(this.path(datasetId), "utf8")) as DiagramDatasetRecord;
  }

  private async write(record: DiagramDatasetRecord): Promise<void> {
    const path = this.path(record.id);
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    await rename(temporary, path);
  }

  async list(): Promise<DiagramDatasetCatalogSnapshot> {
    let entries;
    try {
      entries = await readdir(this.root, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { datasets: [] };
      throw error;
    }
    const records = await Promise.all(entries
      .filter((entry) => entry.isDirectory() && /^[a-z0-9][a-z0-9-]{0,127}$/.test(entry.name))
      .map(async (entry) => {
        try { return await this.read(entry.name); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
          throw error;
        }
      }));
    return {
      datasets: records
        .filter((record): record is DiagramDatasetRecord => Boolean(record))
        .map(summary)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    };
  }

  async create(name: unknown): Promise<DiagramDatasetSummary> {
    const now = new Date().toISOString();
    const record: DiagramDatasetRecord = {
      schemaVersion: 1,
      id: `dataset-${randomUUID().replaceAll("-", "").slice(0, 16)}`,
      name: normalizeName(name),
      items: [],
      createdAt: now,
      updatedAt: now
    };
    await this.write(record);
    return summary(record);
  }

  async item(datasetId: string, itemId: string): Promise<DiagramDatasetItemRecord> {
    assertId(itemId, "dataset item id");
    const item = (await this.read(datasetId)).items.find((candidate) => candidate.id === itemId);
    if (!item) throw new Error(`dataset item not found: ${itemId}`);
    return item;
  }

  async addItem(datasetId: string, draft: Omit<DiagramDatasetItemRecord, "id" | "addedAt" | "labels"> & { labels: unknown }): Promise<AddDiagramDatasetItemResult> {
    const record = await this.read(datasetId);
    const candidate: DiagramDatasetItemRecord = {
      ...draft,
      id: `item-${randomUUID().replaceAll("-", "").slice(0, 16)}`,
      labels: normalizeDatasetLabels(draft.labels),
      addedAt: new Date().toISOString()
    };
    const existing = record.items.find((item) => sourceKey(item) === sourceKey(candidate));
    if (existing) return { dataset: summary(record), item: summary(record).items.find((item) => item.id === existing.id)!, added: false };
    const next = { ...record, items: [...record.items, candidate], updatedAt: candidate.addedAt };
    await this.write(next);
    return { dataset: summary(next), item: summary(next).items.find((item) => item.id === candidate.id)!, added: true };
  }

  async updateLabels(datasetId: string, itemId: string, labels: unknown): Promise<DiagramDatasetSummary> {
    assertId(itemId, "dataset item id");
    const record = await this.read(datasetId);
    if (!record.items.some((item) => item.id === itemId)) throw new Error(`dataset item not found: ${itemId}`);
    const now = new Date().toISOString();
    const next = {
      ...record,
      items: record.items.map((item) => item.id === itemId ? { ...item, labels: normalizeDatasetLabels(labels) } : item),
      updatedAt: now
    };
    await this.write(next);
    return summary(next);
  }

  async removeItem(datasetId: string, itemId: string): Promise<DiagramDatasetSummary> {
    assertId(itemId, "dataset item id");
    const record = await this.read(datasetId);
    if (!record.items.some((item) => item.id === itemId)) throw new Error(`dataset item not found: ${itemId}`);
    const next = { ...record, items: record.items.filter((item) => item.id !== itemId), updatedAt: new Date().toISOString() };
    await this.write(next);
    return summary(next);
  }
}
