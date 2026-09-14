import path from "node:path";
import {
  assertSafeId
} from "../../../domain/core/records/domain";
import type { PersistenceContext } from './context';

export function projectPath(context: PersistenceContext): string {
  return path.join(context.storeRoot, "project.json");
}

export function highlightsPath(context: PersistenceContext): string {
  return path.join(context.storeRoot, "highlights.json");
}

export function spatialProgressPath(context: PersistenceContext): string {
  return path.join(context.storeRoot, "spatial-progress.json");
}

export function plansRoot(context: PersistenceContext): string {
  return path.join(context.storeRoot, "plans");
}

export function planRoot(context: PersistenceContext, planId: string): string {
  assertSafeId(planId, "Plan id");
  return path.join(plansRoot(context), planId);
}

export function planManifestPath(context: PersistenceContext, planId: string): string {
  return path.join(planRoot(context, planId), "plan.json");
}

export function planMarkdownPath(context: PersistenceContext, planId: string): string {
  return path.join(planRoot(context, planId), "plan.md");
}

export function planSelectionPath(context: PersistenceContext, planId: string): string {
  return path.join(planRoot(context, planId), "selection.json");
}

export function planChangeRoot(context: PersistenceContext, planId: string, changeId: string): string {
  assertSafeId(changeId, "Plan change id");
  return path.join(planRoot(context, planId), "changes", changeId);
}

export function planChangePath(context: PersistenceContext, planId: string, changeId: string, filename: string): string {
  return path.join(planChangeRoot(context, planId, changeId), filename);
}

export function systemPromptTemplatesPath(context: PersistenceContext): string {
  return path.join(context.storeRoot, "system-prompt-templates.json");
}

export function codeEntityPromptTemplatesPath(context: PersistenceContext): string {
  return path.join(context.storeRoot, "code-entity-prompt-templates.json");
}

export function importsRoot(context: PersistenceContext): string {
  return path.join(context.storeRoot, "imports");
}

export function importsIndexPath(context: PersistenceContext): string {
  return path.join(importsRoot(context), "library.json");
}

export function importedDiagramPath(context: PersistenceContext, diagramId: string): string {
  assertSafeId(diagramId, "Diagram id");
  return path.join(importsRoot(context), "diagrams", `${diagramId}.json`);
}

export function importedDiagramComponentPath(context: PersistenceContext, componentId: string): string {
  assertSafeId(componentId, "DiagramComponent id");
  return path.join(importsRoot(context), "diagram-components", `${componentId}.json`);
}

export function importedCodeEntityPath(context: PersistenceContext, entityId: string): string {
  assertSafeId(entityId, "CodeEntity id");
  return path.join(importsRoot(context), "code-entities", `${entityId}.json`);
}

export function importedCodeEntityMapPath(context: PersistenceContext, artifactId: string): string {
  assertSafeId(artifactId, "artifact id");
  return path.join(importsRoot(context), "code-entity-maps", `${artifactId}.json`);
}

export function setRoot(context: PersistenceContext, setId: string): string {
  assertSafeId(setId, "DiagramSet id");
  return path.join(context.storeRoot, "diagram-sets", setId);
}

export function setPath(context: PersistenceContext, setId: string): string {
  return path.join(setRoot(context, setId), "diagram-set.json");
}

export function entitiesPath(context: PersistenceContext, setId: string): string {
  return path.join(setRoot(context, setId), "code-entities.json");
}

export function diagramPath(context: PersistenceContext, setId: string, diagramId: string): string {
  assertSafeId(diagramId, "Diagram id");
  return path.join(setRoot(context, setId), "diagrams", `${diagramId}.json`);
}

export function diagramComponentPath(context: PersistenceContext, setId: string, componentId: string): string {
  assertSafeId(componentId, "DiagramComponent id");
  return path.join(setRoot(context, setId), "diagram-components", `${componentId}.json`);
}

export function batchPath(context: PersistenceContext, setId: string, batchId: string): string {
  assertSafeId(batchId, "GenerationBatch id");
  return path.join(setRoot(context, setId), "generation-batches", `${batchId}.json`);
}

export function diagramCandidateBatchPath(context: PersistenceContext, setId: string, candidateBatchId: string): string {
  assertSafeId(candidateBatchId, "DiagramCandidateBatch id");
  return path.join(
    setRoot(context, setId),
    "diagram-candidate-batches",
    `${candidateBatchId}.json`
  );
}

export function promptConfigPath(context: PersistenceContext, setId: string, promptConfigId: string): string {
  assertSafeId(promptConfigId, "GenerationPromptConfig id");
  return path.join(setRoot(context, setId), "generation-prompts", `${promptConfigId}.json`);
}

export function codeEntityPromptConfigPath(context: PersistenceContext, setId: string, promptConfigId: string): string {
  assertSafeId(promptConfigId, "CodeEntityPromptConfig id");
  return path.join(setRoot(context, setId), "code-entity-prompts", `${promptConfigId}.json`);
}

export function runPath(context: PersistenceContext, setId: string, runId: string): string {
  assertSafeId(runId, "AgentRun id");
  return path.join(setRoot(context, setId), "runs", `${runId}.json`);
}

export function editSessionPath(context: PersistenceContext, setId: string, sessionId: string): string {
  assertSafeId(sessionId, "EditSession id");
  return path.join(setRoot(context, setId), "edit-sessions", `${sessionId}.json`);
}

export function codeEntityMapPath(context: PersistenceContext, setId: string, artifactId: string): string {
  assertSafeId(artifactId, "artifact id");
  return path.join(setRoot(context, setId), "code-entity-maps", `${artifactId}.json`);
}

export function representationGraphPath(context: PersistenceContext, setId: string): string {
  return path.join(setRoot(context, setId), "representation-graph.json");
}
