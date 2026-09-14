import {
  type AgentRunRecord,
  type CodeEntitiesSetRecord,
  type CodeEntityPromptConfigRecord,
  type CodeEntityRecord,
  type DiagramSetRecord
} from "../../../domain/core/records/domain";
import { loadCodeEntities } from './artifacts';
import type { PersistenceContext } from './context';
import { saveCodeEntityPromptConfig } from './generation';
import { entitiesPath, runPath, setPath } from './paths';
import { loadDiagramSet } from './projects';
import { nowIso, readJson, writeJsonAtomic } from './shared';

export async function saveRun(context: PersistenceContext, run: AgentRunRecord): Promise<void> {
  await writeJsonAtomic(runPath(context, run.diagramSetId, run.id), run);
}

export async function loadRun(context: PersistenceContext, setId: string, runId: string): Promise<AgentRunRecord> {
  return readJson<AgentRunRecord>(runPath(context, setId, runId));
}

export async function attachRuns(context: PersistenceContext, setId: string, runIds: string[]): Promise<DiagramSetRecord> {
  const set = await loadDiagramSet(context, setId);
  const nextIds = [...new Set([...set.agentRunIds, ...runIds])];
  if (nextIds.length === set.agentRunIds.length) return set;
  const updated = { ...set, agentRunIds: nextIds, updatedAt: nowIso() };
  await writeJsonAtomic(setPath(context, setId), updated);
  return updated;
}

export async function attachRun(context: PersistenceContext, setId: string, runId: string): Promise<DiagramSetRecord> {
  return attachRuns(context, setId, [runId]);
}

export async function beginCodeEntityCollection(context: PersistenceContext, config: CodeEntityPromptConfigRecord): Promise<void> {
  const current = await loadCodeEntities(context, config.diagramSetId);
  if (current.status === "finalized") {
    throw new Error("CodeEntitiesSet is immutable after finalization");
  }
  await saveCodeEntityPromptConfig(context, config);
  await writeJsonAtomic(entitiesPath(context, config.diagramSetId), {
    ...current,
    status: "collecting",
    promptConfigId: config.id,
    error: undefined
  });
}

export async function completeCollection(context: PersistenceContext, setId: string, entities: CodeEntityRecord[]): Promise<void> {
  const current = await loadCodeEntities(context, setId);
  if (current.status === "finalized") throw new Error("CodeEntitiesSet is immutable after finalization");
  const timestamp = nowIso();
  const updatedEntities: CodeEntitiesSetRecord = {
    ...current,
    status: "finalized",
    entities,
    finalizedAt: timestamp,
    error: undefined
  };
  await writeJsonAtomic(entitiesPath(context, setId), updatedEntities);
  const set = await loadDiagramSet(context, setId);
  await writeJsonAtomic(setPath(context, setId), {
    ...set,
    readiness: "ready",
    updatedAt: timestamp,
    error: undefined
  });
}

export async function failCollection(context: PersistenceContext, setId: string, message: string): Promise<void> {
  const entities = await loadCodeEntities(context, setId);
  if (entities.status !== "finalized") {
    await writeJsonAtomic(entitiesPath(context, setId), { ...entities, status: "failed", error: message });
  }
  const set = await loadDiagramSet(context, setId);
  await writeJsonAtomic(setPath(context, setId), {
    ...set,
    readiness: "failed",
    updatedAt: nowIso(),
    error: message
  });
}
