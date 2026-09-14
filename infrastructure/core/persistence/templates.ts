import type { BuiltInDomainProfileId } from "../../../domain/core/profiles/domainProfile";
import {
  createBuiltInCodeEntityPromptTemplates,
  createBuiltInSystemPromptTemplates,
  createSystemPromptTemplate,
  generationPromptBindings,
  promptTemplate
} from "../../../domain/core/prompts/prompt";
import {
  SCHEMA_VERSION,
  type CodeEntityPromptTemplateRecord,
  type GenerationTargetKind,
  type SystemPromptTemplateRecord
} from "../../../domain/core/records/domain";
import type { PersistenceContext } from './context';
import { codeEntityPromptTemplatesPath, systemPromptTemplatesPath } from './paths';
import { nowIso, readJsonIfExists, writeJsonAtomic } from './shared';

export async function loadSystemPromptTemplates(context: PersistenceContext): Promise<SystemPromptTemplateRecord[]> {
  const stored = await readJsonIfExists<{
    schemaVersion: typeof SCHEMA_VERSION;
    templates: unknown[];
  }>(systemPromptTemplatesPath(context));
  if (stored) {
    const builtIns = new Map(createBuiltInSystemPromptTemplates(nowIso()).map((item) => [item.id, item]));
    let changed = false;
    const targetKinds: GenerationTargetKind[] = [
      "diagram", "call-graph", "dir-view", "diagram-component"
    ];
    const migrateManagedVariables = (value: string) => value
      .replace(/{{\s*outputKind\s*}}/g, "artifact")
      .replace(/{{\s*submissionTool\s*}}/g, "the registered submission tool")
      .replace(/{{\s*referenceInstruction\s*}}/g, "the system-managed reference instruction below")
      .replace(/{{\s*referenceContext\s*}}/g, "the system-managed reference context below")
      .replace(/{{\s*mappingArtifact\s*}}/g, "the system-managed final artifact below")
      .replace(/{{\s*mappingEntities\s*}}/g, "the system-managed CodeEntity context below");
    const templates: SystemPromptTemplateRecord[] = stored.templates.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("invalid stored system prompt template");
      }
      const template = value as Record<string, unknown>;
      const id = typeof template.id === "string" ? template.id : "";
      const rawPrompts = template.prompts && typeof template.prompts === "object"
        ? template.prompts as Record<string, unknown>
        : {};
      const namedDictionary = Object.values(rawPrompts).every((entry) => (
        Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)
        && typeof (entry as Record<string, unknown>).template === "string"
      ));
      if (namedDictionary && Object.keys(rawPrompts).length) {
        const prompts = Object.fromEntries(Object.entries(rawPrompts).map(([name, entry]) => {
          const prompt = entry as { template: string; description?: string };
          const migratedTemplate = migrateManagedVariables(prompt.template);
          if (migratedTemplate !== prompt.template) changed = true;
          return [name, { ...prompt, template: migratedTemplate }];
        }));
        return createSystemPromptTemplate({
          id,
          label: typeof template.label === "string" ? template.label : id,
          description: typeof template.description === "string" ? template.description : "",
          builtIn: template.builtIn === true,
          version: typeof template.version === "number" ? template.version : 1,
          prompts,
          createdAt: typeof template.createdAt === "string" ? template.createdAt : nowIso(),
          updatedAt: typeof template.updatedAt === "string" ? template.updatedAt : nowIso()
        });
      }

      changed = true;
      const fallback = builtIns.get(id) ?? createBuiltInSystemPromptTemplates(nowIso())[0];
      const legacyReferences = template.referencePrompts && typeof template.referencePrompts === "object"
        ? template.referencePrompts as Record<string, unknown>
        : {};
      const legacyMappings = template.mappingPrompts && typeof template.mappingPrompts === "object"
        ? template.mappingPrompts as Record<string, unknown>
        : {};
      const prompts: Record<string, string> = {};
      for (const targetKind of targetKinds) {
        const bindings = generationPromptBindings(targetKind);
        const system = typeof rawPrompts[targetKind] === "string"
          ? rawPrompts[targetKind] as string
          : promptTemplate(fallback, bindings.system);
        const reference = typeof legacyReferences[targetKind] === "string"
          ? legacyReferences[targetKind] as string
          : promptTemplate(fallback, bindings.reference!);
        const mapping = typeof legacyMappings[targetKind] === "string"
          ? legacyMappings[targetKind] as string
          : promptTemplate(fallback, bindings.mapping);
        prompts[bindings.system] = migrateManagedVariables(system);
        prompts[bindings.reference!] = migrateManagedVariables(reference);
        prompts[bindings.mapping] = migrateManagedVariables(mapping);
      }
      return createSystemPromptTemplate({
        id,
        label: typeof template.label === "string" ? template.label : id,
        description: typeof template.description === "string" ? template.description : "",
        builtIn: template.builtIn === true,
        version: typeof template.version === "number" ? template.version : 1,
        prompts,
        createdAt: typeof template.createdAt === "string" ? template.createdAt : nowIso(),
        updatedAt: typeof template.updatedAt === "string" ? template.updatedAt : nowIso()
      });
    });
    if (changed) await saveSystemPromptTemplates(context, templates);
    return templates;
  }
  const templates = createBuiltInSystemPromptTemplates(nowIso());
  await writeJsonAtomic(systemPromptTemplatesPath(context), {
    schemaVersion: SCHEMA_VERSION,
    templates
  });
  return templates;
}

export async function saveSystemPromptTemplates(context: PersistenceContext, templates: SystemPromptTemplateRecord[]): Promise<void> {
  await writeJsonAtomic(systemPromptTemplatesPath(context), {
    schemaVersion: SCHEMA_VERSION,
    templates
  });
}

export async function loadCodeEntityPromptTemplates(context: PersistenceContext, domainProfileId: BuiltInDomainProfileId = "source-code"): Promise<CodeEntityPromptTemplateRecord[]> {
  const stored = await readJsonIfExists<{
    schemaVersion: typeof SCHEMA_VERSION;
    templates: CodeEntityPromptTemplateRecord[];
  }>(codeEntityPromptTemplatesPath(context));
  if (stored) {
    if (domainProfileId !== "document") return stored.templates;
    const sourceBuiltIn = createBuiltInCodeEntityPromptTemplates("legacy", "source-code")[0];
    let changed = false;
    const templates = stored.templates.map((template) => {
      const isUnmodifiedSourceBuiltIn = template.id === sourceBuiltIn.id
        && template.builtIn
        && template.label === sourceBuiltIn.label
        && template.description === sourceBuiltIn.description
        && JSON.stringify(template.prompts) === JSON.stringify(sourceBuiltIn.prompts);
      if (!isUnmodifiedSourceBuiltIn) return template;
      changed = true;
      const migrated = createBuiltInCodeEntityPromptTemplates(template.createdAt, "document")[0];
      return { ...migrated, version: template.version, updatedAt: template.updatedAt };
    });
    if (changed) await saveCodeEntityPromptTemplates(context, templates);
    return templates;
  }
  const templates = createBuiltInCodeEntityPromptTemplates(nowIso(), domainProfileId);
  await writeJsonAtomic(codeEntityPromptTemplatesPath(context), {
    schemaVersion: SCHEMA_VERSION,
    templates
  });
  return templates;
}

export async function saveCodeEntityPromptTemplates(context: PersistenceContext, templates: CodeEntityPromptTemplateRecord[]): Promise<void> {
  await writeJsonAtomic(codeEntityPromptTemplatesPath(context), {
    schemaVersion: SCHEMA_VERSION,
    templates
  });
}
