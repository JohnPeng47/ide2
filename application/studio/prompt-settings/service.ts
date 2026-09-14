import type { BuiltInDomainProfileId } from "../../../domain/core/profiles/domainProfile";
import {
  createBuiltInCodeEntityPromptTemplates,
  createBuiltInSystemPromptTemplates,
  createSystemPromptTemplate,
  generationPromptBindings,
  promptTemplate,
  renderMappingPromptTemplate,
  renderReferencePromptTemplate,
  renderSystemPromptTemplate
} from "../../../domain/core/prompts/prompt";
import {
  DEFAULT_CODE_ENTITY_PROMPT_PROFILE_ID,
  DEFAULT_GENERATION_PROMPT_PROFILE_ID,
  SCHEMA_VERSION,
  slugify,
  type CodeEntityPromptTemplateRecord,
  type GenerationTargetKind,
  type NamedPromptTemplate,
  type SystemPromptTemplateRecord,
  type WorkspaceSnapshot
} from "../../../domain/core/records/domain";
import type { StudioContext } from '../context';
import { timestamp } from '../shared';

export async function systemPromptTemplates(context: StudioContext): Promise<SystemPromptTemplateRecord[]> {
  return context.store.loadSystemPromptTemplates();
}

export async function codeEntityPromptTemplates(context: StudioContext): Promise<CodeEntityPromptTemplateRecord[]> {
  const project = await context.store.loadProject();
  const domain = project?.domainProfileId === "document"
    ? "document"
    : context.defaultDomainProfileId;
  return context.store.loadCodeEntityPromptTemplates(domain);
}

export async function resolveCodeEntityPromptTemplate(context: StudioContext, id?: unknown, requestedDomain?: BuiltInDomainProfileId): Promise<CodeEntityPromptTemplateRecord> {
  const useDefault = id === undefined || id === null;
  const requestedId = useDefault ? DEFAULT_CODE_ENTITY_PROMPT_PROFILE_ID : id;
  if (typeof requestedId !== "string") {
    throw new Error(`unsupported CodeEntity prompt template: ${String(requestedId)}`);
  }
  const project = await context.store.loadProject();
  const domain = requestedDomain
    ?? (project?.domainProfileId === "document" ? "document" : context.defaultDomainProfileId);
  const templates = await context.store.loadCodeEntityPromptTemplates(domain);
  const template = templates.find((candidate) => candidate.id === requestedId)
    ?? (useDefault ? templates[0] : undefined);
  if (!template) {
    const available = templates.map((candidate) => candidate.id).join(", ");
    throw new Error(
      `unsupported CodeEntity prompt template: ${requestedId}; available templates: ${available}`
    );
  }
  return template;
}

export async function resolveSystemPromptTemplate(context: StudioContext, id?: unknown): Promise<SystemPromptTemplateRecord> {
  const useDefault = id === undefined || id === null;
  const requestedId = useDefault ? DEFAULT_GENERATION_PROMPT_PROFILE_ID : id;
  if (typeof requestedId !== "string") {
    throw new Error(`unsupported generation prompt template: ${String(requestedId)}`);
  }
  const legacyIds: Record<string, string> = {
    structureFirst: "structure-first",
    flowFirst: "flow-first"
  };
  const normalizedId = legacyIds[requestedId] ?? requestedId;
  const templates = await context.store.loadSystemPromptTemplates();
  const template = templates.find((candidate) => candidate.id === normalizedId)
    ?? (useDefault ? templates[0] : undefined);
  if (!template) {
    const available = templates.map((candidate) => candidate.id).join(", ");
    throw new Error(
      `unsupported generation prompt template: ${requestedId}; available templates: ${available}`
    );
  }
  return template;
}

export async function saveSystemPromptTemplate(context: StudioContext, input: {
  id?: unknown;
  label: unknown;
  description: unknown;
  prompts: unknown;
}): Promise<WorkspaceSnapshot> {
  const label = typeof input.label === "string" ? input.label.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (!label) throw new Error("template name is required");
  if (label.length > 80) throw new Error("template name cannot exceed 80 characters");
  if (description.length > 240) throw new Error("template description cannot exceed 240 characters");
  if (!input.prompts || typeof input.prompts !== "object" || Array.isArray(input.prompts)) {
    throw new Error("named prompts must be an object");
  }
  const rawPrompts = input.prompts as Record<string, unknown>;
  const prompts: Record<string, NamedPromptTemplate> = {};
  for (const [name, value] of Object.entries(rawPrompts)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`prompt ${name} must be an object with a template string`);
    }
    const entry = value as Record<string, unknown>;
    if (typeof entry.template !== "string") {
      throw new Error(`prompt ${name} must include a template string`);
    }
    if (entry.description !== undefined && typeof entry.description !== "string") {
      throw new Error(`prompt ${name} description must be a string`);
    }
    prompts[name] = {
      template: entry.template,
      ...(typeof entry.description === "string" ? { description: entry.description } : {})
    };
  }
  const templates = await context.store.loadSystemPromptTemplates();
  const requestedId = typeof input.id === "string" ? input.id : undefined;
  const existing = requestedId ? templates.find((template) => template.id === requestedId) : undefined;
  if (requestedId && !existing) throw new Error(`unknown system prompt template: ${requestedId}`);
  const persistedPrompts = Object.fromEntries(Object.entries(prompts).map(([name, entry]) => [
    name,
    entry.description === undefined && existing?.prompts[name]?.description
      ? { ...entry, description: existing.prompts[name].description }
      : entry
  ]));
  const timestampValue = timestamp();
  let id = existing?.id ?? slugify(label, "custom-prompt");
  if (!existing) {
    const ids = new Set(templates.map((template) => template.id));
    const baseId = id;
    let suffix = 2;
    while (ids.has(id)) id = `${baseId}-${suffix++}`;
  }
  const template = createSystemPromptTemplate({
    id,
    label,
    description,
    builtIn: existing?.builtIn ?? false,
    version: (existing?.version ?? 0) + 1,
    prompts: persistedPrompts,
    createdAt: existing?.createdAt ?? timestampValue,
    updatedAt: timestampValue
  });
  const targetKinds: GenerationTargetKind[] = [
    "diagram", "call-graph", "dir-view", "diagram-component"
  ];
  const requiredStandardPromptNames = targetKinds.flatMap((targetKind) => {
    const bindings = generationPromptBindings(targetKind);
    return [bindings.system, bindings.reference!, bindings.mapping];
  });
  const existingWasStandard = Boolean(existing && requiredStandardPromptNames.every(
    (name) => existing.prompts[name]
  ));
  const submittedStandardName = requiredStandardPromptNames.some((name) => template.prompts[name]);
  if ((existingWasStandard || submittedStandardName) && !requiredStandardPromptNames.every(
    (name) => template.prompts[name]
  )) {
    throw new Error("standard generation prompt sets require every system, reference, and mapping prompt");
  }
  for (const targetKind of (existingWasStandard || submittedStandardName ? targetKinds : [])) {
    const bindings = generationPromptBindings(targetKind);
    renderSystemPromptTemplate(promptTemplate(template, bindings.system), targetKind);
    renderReferencePromptTemplate({
      template: promptTemplate(template, bindings.reference!),
      targetKind,
      instruction: targetKind === "diagram-component"
        ? "Use @component/reference as the style reference."
        : "Use @diagram/reference as the style reference.",
      referenceContext: targetKind === "diagram-component"
        ? "DiagramComponent reference"
        : "Diagram reference"
    });
    renderMappingPromptTemplate({
      template: promptTemplate(template, bindings.mapping),
      targetKind,
      artifact: { name: "Preview", ascii: "+-- preview --+", codeEntityIds: [] },
      codeEntities: [],
      aliases: []
    });
  }
  await context.store.saveSystemPromptTemplates(existing
    ? templates.map((candidate) => candidate.id === id ? template : candidate)
    : [...templates, template]);
  return context.core.workspace();
}

export async function resetSystemPromptTemplate(context: StudioContext, id: string): Promise<WorkspaceSnapshot> {
  const templates = await context.store.loadSystemPromptTemplates();
  const existing = templates.find((template) => template.id === id);
  if (!existing?.builtIn) throw new Error(`built-in system prompt template not found: ${id}`);
  const original = createBuiltInSystemPromptTemplates(existing.createdAt)
    .find((template) => template.id === id);
  if (!original) throw new Error(`built-in system prompt template not found: ${id}`);
  const reset: SystemPromptTemplateRecord = {
    ...original,
    version: existing.version + 1,
    createdAt: existing.createdAt,
    updatedAt: timestamp()
  };
  await context.store.saveSystemPromptTemplates(
    templates.map((template) => template.id === id ? reset : template)
  );
  return context.core.workspace();
}

export async function deleteSystemPromptTemplate(context: StudioContext, id: string): Promise<WorkspaceSnapshot> {
  const templates = await context.store.loadSystemPromptTemplates();
  const existing = templates.find((template) => template.id === id);
  if (!existing) throw new Error(`unknown system prompt template: ${id}`);
  if (templates.length === 1) throw new Error("at least one system prompt template is required");
  await context.store.saveSystemPromptTemplates(
    templates.filter((template) => template.id !== id)
  );
  return context.core.workspace();
}

export async function saveCodeEntityPromptTemplate(context: StudioContext, input: {
  id?: unknown;
  label: unknown;
  description: unknown;
  prompts: unknown;
}): Promise<WorkspaceSnapshot> {
  const label = typeof input.label === "string" ? input.label.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  const prompts = input.prompts && typeof input.prompts === "object"
    ? input.prompts as Record<string, unknown>
    : {};
  const identificationCriteria = typeof prompts["code-entity-identification"] === "string"
    ? prompts["code-entity-identification"].trim()
    : "";
  const compactionCriteria = typeof prompts["code-entity-compaction"] === "string"
    ? prompts["code-entity-compaction"].trim()
    : "";
  if (!label) throw new Error("template name is required");
  if (label.length > 80) throw new Error("template name cannot exceed 80 characters");
  if (description.length > 240) throw new Error("template description cannot exceed 240 characters");
  if (!identificationCriteria || !compactionCriteria) {
    throw new Error("identification and compaction criteria are required");
  }
  if (identificationCriteria.length > 32000 || compactionCriteria.length > 32000) {
    throw new Error("CodeEntity criteria cannot exceed 32,000 characters");
  }

  const templates = await context.store.loadCodeEntityPromptTemplates();
  const requestedId = typeof input.id === "string" ? input.id : undefined;
  const existing = requestedId ? templates.find((template) => template.id === requestedId) : undefined;
  if (requestedId && !existing) throw new Error(`unknown CodeEntity prompt template: ${requestedId}`);
  const timestampValue = timestamp();
  let id = existing?.id ?? slugify(label, "custom-code-entities");
  if (!existing) {
    const ids = new Set(templates.map((template) => template.id));
    const baseId = id;
    let suffix = 2;
    while (ids.has(id)) id = `${baseId}-${suffix++}`;
  }
  const template: CodeEntityPromptTemplateRecord = {
    schemaVersion: SCHEMA_VERSION,
    id,
    label,
    description,
    builtIn: existing?.builtIn ?? false,
    version: (existing?.version ?? 0) + 1,
    prompts: {
      "code-entity-identification": identificationCriteria,
      "code-entity-compaction": compactionCriteria
    },
    createdAt: existing?.createdAt ?? timestampValue,
    updatedAt: timestampValue
  };
  await context.store.saveCodeEntityPromptTemplates(existing
    ? templates.map((candidate) => candidate.id === id ? template : candidate)
    : [...templates, template]);
  return context.core.workspace();
}

export async function resetCodeEntityPromptTemplate(context: StudioContext, id: string): Promise<WorkspaceSnapshot> {
  const templates = await context.store.loadCodeEntityPromptTemplates();
  const existing = templates.find((template) => template.id === id);
  if (!existing?.builtIn) throw new Error(`built-in CodeEntity prompt template not found: ${id}`);
  const project = await context.store.loadProject();
  const domain = project?.domainProfileId === "document" ? "document" : "source-code";
  const original = createBuiltInCodeEntityPromptTemplates(existing.createdAt, domain)
    .find((template) => template.id === id);
  if (!original) throw new Error(`built-in CodeEntity prompt template not found: ${id}`);
  const reset: CodeEntityPromptTemplateRecord = {
    ...original,
    version: existing.version + 1,
    createdAt: existing.createdAt,
    updatedAt: timestamp()
  };
  await context.store.saveCodeEntityPromptTemplates(
    templates.map((template) => template.id === id ? reset : template)
  );
  return context.core.workspace();
}

export async function deleteCodeEntityPromptTemplate(context: StudioContext, id: string): Promise<WorkspaceSnapshot> {
  const templates = await context.store.loadCodeEntityPromptTemplates();
  const existing = templates.find((template) => template.id === id);
  if (!existing) throw new Error(`unknown CodeEntity prompt template: ${id}`);
  if (templates.length === 1) throw new Error("at least one CodeEntity prompt template is required");
  await context.store.saveCodeEntityPromptTemplates(
    templates.filter((template) => template.id !== id)
  );
  return context.core.workspace();
}
