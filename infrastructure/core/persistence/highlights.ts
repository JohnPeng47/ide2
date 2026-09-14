import type { SpatialProgressState } from "../../../domain/core/agent-work/agentWork";
import { isHighlightRecordV2, validateHighlightRecordV2 } from "../../../domain/core/highlights/highlights";
import {
  SCHEMA_VERSION,
  assertSafeId
} from "../../../domain/core/records/domain";
import type { PersistenceContext } from './context';
import { highlightsPath, spatialProgressPath } from './paths';
import { PersistedHighlight, readJsonIfExists, writeJsonAtomic } from './shared';

export async function loadHighlights(context: PersistenceContext): Promise<PersistedHighlight[]> {
  const stored = await readJsonIfExists<{
    schemaVersion: typeof SCHEMA_VERSION;
    highlights: PersistedHighlight[];
  }>(highlightsPath(context));
  const highlights = stored?.highlights ?? [];
  for (const highlight of highlights) {
    if (isHighlightRecordV2(highlight)) validateHighlightRecordV2(highlight);
  }
  return highlights;
}

export async function loadSpatialProgress(context: PersistenceContext): Promise<Record<string, SpatialProgressState>> {
  const stored = await readJsonIfExists<{
    schemaVersion: typeof SCHEMA_VERSION;
    states: Record<string, SpatialProgressState>;
  }>(spatialProgressPath(context));
  return stored?.states ?? {};
}

export async function saveSpatialProgress(context: PersistenceContext, runId: string, state: SpatialProgressState): Promise<void> {
  assertSafeId(runId, "AgentRun id");
  const states = await loadSpatialProgress(context);
  await writeJsonAtomic(spatialProgressPath(context), {
    schemaVersion: SCHEMA_VERSION,
    states: { ...states, [runId]: state }
  });
}

export async function saveHighlight(context: PersistenceContext, highlight: PersistedHighlight): Promise<void> {
  if (isHighlightRecordV2(highlight)) validateHighlightRecordV2(highlight);
  const highlights = await loadHighlights(context);
  const withoutDuplicate = highlights.filter((candidate) => !(
    candidate.diagramSetId === highlight.diagramSetId
    && candidate.artifactId === highlight.artifactId
    && (candidate.mappingId === highlight.mappingId
      || (isHighlightRecordV2(candidate) && isHighlightRecordV2(highlight)
        && candidate.representationElementId === highlight.representationElementId))
  ));
  await writeJsonAtomic(highlightsPath(context), {
    schemaVersion: SCHEMA_VERSION,
    highlights: [...withoutDuplicate, highlight]
  });
}

export async function deleteHighlight(context: PersistenceContext, highlightId: string): Promise<void> {
  assertSafeId(highlightId, "highlight id");
  const highlights = await loadHighlights(context);
  await writeJsonAtomic(highlightsPath(context), {
    schemaVersion: SCHEMA_VERSION,
    highlights: highlights.filter((highlight) => highlight.id !== highlightId)
  });
}
