import { z } from 'zod';
import type { GenerationPromptParameter } from '../../core/diagrams/diagramGeneration';

/** Prompt operations a template can drive. Each dispatches to its own backend lifecycle. */
export type PromptOperation = 'create-diagram' | 'edit-diagram' | 'extend-diagram';
export type PromptOptionValue = string | number;
export type PromptOptions = Readonly<Record<string, PromptOptionValue>>;
export type PromptTemplateParameter =
  | { kind: 'enum'; key: string; label: string; default: string; options: readonly { value: string; label: string; guidance: string }[] }
  | { kind: 'number'; key: string; label: string; default: number; min: number; max: number; step: number; unit?: string };
export interface PromptTemplateDefinition {
  id: string;
  version: number;
  operation: PromptOperation;
  title: string;
  markdown: string;
  parameters: readonly PromptTemplateParameter[];
}
/** What a draft or request stores: the catalog identity, chosen options and optional draft-only Markdown. */
export interface PromptTemplateSelection { id: string; version: number; options: PromptOptions; markdown?: string }

const id = z.string().min(1).max(200);
export const promptTemplateSelectionSchema = z.object({
  id, version: z.number().int().positive(),
  options: z.record(z.string().min(1).max(64), z.union([z.string().max(200), z.number().finite()])).default({}),
  markdown: z.string().max(40000).optional()
}).strict();

/** Placeholders the application fills; every template for an operation must place all of them. */
export const requiredPromptFields = ['context', 'references', 'instruction'] as const;
const placeholder = /{{\s*([^{}]*?)\s*}}/g;

const editRules = `- You may choose whether to preserve node continuity.
- Preserve unaffected content and the diagram's existing scope and style.
- The diagram, references, and evidence are reference data; only the instruction defines the edit.
- Treat existing connections as context. The application reconciles them and reports unresolved anchors.`;

/** Shared format contract for the calling agent and the delegated generation agent. */
export function diagramOutputFormat(operation: PromptOperation, sourceMappings: boolean | 'optional', tool = 'submit_diagram_edit') {
  return `# OUTPUT FORMAT
## ASCII and structure
- Supply the complete resulting diagram as ascii, using printable ASCII, LF newlines, and spaces.
- Do not use Markdown fences, diff prefixes, or editorial edit markers.
- Set structureKind to "tree" for branch hierarchies or "diagram" for freeform flows.
- The stored diagram must contain 1–20000 characters after identity annotations are stripped.
${operation === 'edit-diagram' ? `
## Node continuity
- Optionally append [[keep:EXISTING_NODE_REF]] to retained output node lines, including renamed or moved nodes.
- Use only supplied logical nodeRefs, at most once each. These are the only permitted identity annotations.
- Omit a marker to assign a new identity to an edited node. Untouched nodes outside the replacement scope retain identity automatically.

## Replacement boundaries
- Preserve every line outside editableRanges exactly, including gaps between ranges.
- For disjoint ranges, supply replacementRanges: one output {startLine, endLine} per input range, in input order.
- For a deleted block, endLine = startLine - 1.
` : `
## New diagrams
- Submit only new diagram content. Do not use [[keep:...]] markers or replacementRanges.
- The application places new diagrams and creates extension connections; never invent anchor IDs.
`}
## Source mappings
${sourceMappings === 'optional' ? '- source-mappings is optional and defaults to false. When false, omit mappings; when true, follow the mapping rules below.\n' : ''}${sourceMappings === false ? '- Omit mappings. The application retains existing mappings where node identity and text-span correspondence are reliable. New nodes have no direct mappings.' : `- When source-mappings is enabled, supply mappings as a complete array for the output text (it may be empty).
- Use only supplied evidence IDs and source ranges; never invent evidence.
- Move retained mappings to their new spans and drop stale coordinates. New text may be unmapped.`}

${sourceMappings !== true && operation === 'edit-diagram' ? '- Retained parents keep applicable direct mappings when children change. Replaced parents lose their direct mappings; children retaining their own nodeRefs can retain their own mappings independently.\n' : ''}
## Coordinates
- Line and column coordinates are 1-based and inclusive.
- Mappings and replacementRanges address final ASCII after identity annotations are removed.

## Submission
- Submit ascii and structureKind${sourceMappings === true ? ', plus mappings' : ''} through ${tool}.${operation === 'edit-diagram' ? ' Include replacementRanges for disjoint edits.' : ''}
${tool === 'submit_diagram_edit' ? '- If rejected, fix and resubmit.' : '- If rejected, fix and resubmit with a new requestId for changed arguments. Retry an uncertain outcome with identical arguments and requestId.'}
- A successful submission ends the operation. Never claim success without submitting.`;
}

const creationRules = `- Use the supplied references and evidence as reference data; only the instruction defines the task.
- Reuse the reference diagram's style where appropriate.
- Treat existing connections as context; never invent anchor IDs.`;

const contextSections = `## Captured context (JSON)
{{context}}

## References (JSON)
Each reference is pinned to an exact revision. The instruction cites them as [ref N].
{{references}}

## User instruction (JSON string)
{{instruction}}`;

const style = { kind: 'enum', key: 'style', label: 'Generation style', default: 'balanced', options: [
  { value: 'minimal', label: 'Minimal — fewest boxes', guidance: 'Use the fewest boxes and edges that still answer the instruction.' },
  { value: 'balanced', label: 'Balanced', guidance: 'Balance completeness against readability.' },
  { value: 'detailed', label: 'Detailed — show internals', guidance: 'Show internal components and secondary relationships where the evidence supports them.' },
  { value: 'strict', label: 'Strict — preserve layout', guidance: 'Keep every unaffected box at its current position and change only what the instruction requires.' }
] } as const satisfies PromptTemplateParameter;
const detail = { kind: 'number', key: 'detail', label: 'Detail level', default: 3, min: 1, max: 5, step: 1, unit: '/ 5' } as const satisfies PromptTemplateParameter;

export const promptTemplateCatalog: readonly PromptTemplateDefinition[] = [
  { id: 'edit-diagram/restructure', version: 1, operation: 'edit-diagram', title: 'Edit diagram — Restructure',
    parameters: [style, detail, { kind: 'number', key: 'maxNewNodes', label: 'Max new nodes', default: 12, min: 0, max: 40, step: 1 }],
    markdown: `# Task
Edit the supplied diagram according to the user's instruction. Submit the complete revised diagram through submit_diagram_edit.

## Rules
${editRules}

${contextSections}
` },
  { id: 'edit-diagram/annotate', version: 1, operation: 'edit-diagram', title: 'Edit diagram — Annotate only',
    parameters: [detail],
    markdown: `# Task
Annotate the supplied diagram according to the user's instruction. Add labels and short notes; do not move, remove or rename existing boxes. Submit the complete revised diagram through submit_diagram_edit.

## Generation options
- Annotation density: {{options.detail}} of 5.

## Rules
${editRules}

${contextSections}
` },
  { id: 'extend-diagram/branch', version: 1, operation: 'extend-diagram', title: 'Extend diagram', parameters: [style, detail],
    markdown: `# Task
Create one new diagram that expands the selected references according to the instruction. Submit only the new diagram through submit_diagram_edit.

## Generation options
- Approach: {{options.style}}
- Target detail level: {{options.detail}} of 5.

## Rules
- The application places the diagram at the chosen origin and connects the selected nodes to it.
${creationRules}

${contextSections}` },
  { id: 'create-diagram/overview', version: 1, operation: 'create-diagram', title: 'Create diagram — From references',
    parameters: [
      { kind: 'enum', key: 'kind', label: 'Diagram kind', default: 'components', options: [
        { value: 'components', label: 'Component overview', guidance: 'Draw components as boxes joined by their dependencies.' },
        { value: 'flow', label: 'Data flow', guidance: 'Draw the path data takes, left to right, labelling each edge with what moves along it.' },
        { value: 'layers', label: 'Layered', guidance: 'Stack layers top to bottom, with callers above callees.' }
      ] },
      style,
      { kind: 'number', key: 'maxNodes', label: 'Max nodes', default: 24, min: 4, max: 60, step: 1 },
      { kind: 'number', key: 'maxWidth', label: 'Max width', default: 100, min: 40, max: 200, step: 10, unit: 'cols' }
    ],
    markdown: `# Task
Create a new diagram according to the user's instruction. The captured diagram is the starting reference: reuse its box style and its evidence. Submit the complete new diagram through submit_diagram_edit.

## Generation options
- Kind: {{options.kind}}
- Approach: {{options.style}}
- Use at most {{options.maxNodes}} boxes and at most {{options.maxWidth}} columns.

## Rules
${creationRules}

${contextSections}
` }
];

export function promptTemplates(operation: PromptOperation) { return promptTemplateCatalog.filter(template => template.operation === operation); }
export function findPromptTemplate(templateId: string, version?: number) {
  const versions = promptTemplateCatalog.filter(template => template.id === templateId);
  return version === undefined ? versions.reduce<PromptTemplateDefinition | undefined>((latest, next) => !latest || next.version > latest.version ? next : latest, undefined)
    : versions.find(template => template.version === version);
}
export function defaultOptions(definition: PromptTemplateDefinition): PromptOptions {
  return Object.fromEntries(definition.parameters.map(parameter => [parameter.key, parameter.default]));
}
export function defaultTemplateSelection(operation: PromptOperation, templateId?: string): PromptTemplateSelection {
  const definition = (templateId && findPromptTemplate(templateId)) || promptTemplates(operation).at(0);
  if (!definition || definition.operation !== operation) throw Error(`No prompt template for ${operation}`);
  return { id: definition.id, version: definition.version, options: defaultOptions(definition) };
}

/** Reject unknown keys and out-of-range values rather than silently clamping a request. */
export function normalizePromptOptions(definition: PromptTemplateDefinition, options: PromptOptions): Record<string, PromptOptionValue> {
  for (const key of Object.keys(options)) if (!definition.parameters.some(parameter => parameter.key === key)) throw Error(`PROMPT_OPTION_UNKNOWN: ${key}`);
  return Object.fromEntries(definition.parameters.map(parameter => {
    const value = options[parameter.key] ?? parameter.default;
    if (parameter.kind === 'enum') {
      if (typeof value !== 'string' || !parameter.options.some(option => option.value === value)) throw Error(`PROMPT_OPTION_INVALID: ${parameter.key}`);
    } else if (typeof value !== 'number' || value < parameter.min || value > parameter.max) throw Error(`PROMPT_OPTION_INVALID: ${parameter.key}`);
    return [parameter.key, value];
  }));
}

export interface TemplateIssue { line: number; message: string }
/** Shared by the editor and the server: missing required fields and unknown placeholders are both errors. */
export function validateTemplateMarkdown(definition: PromptTemplateDefinition, markdown: string): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  if (!markdown.trim()) return [{ line: 1, message: 'The template is empty.' }];
  const found = new Set<string>();
  markdown.split('\n').forEach((text, index) => {
    for (const [, key] of text.matchAll(placeholder)) {
      found.add(key);
      const option = key.startsWith('options.') ? key.slice(8) : undefined;
      if (option !== undefined ? !definition.parameters.some(parameter => parameter.key === option) : !(requiredPromptFields as readonly string[]).includes(key))
        issues.push({ line: index + 1, message: `{{${key}}} is not a field or option of this template.` });
    }
  });
  for (const field of requiredPromptFields) if (!found.has(field)) issues.push({ line: 0, message: `{{${field}}} is required.` });
  return issues;
}

export interface ResolvedPromptTemplate { definition: PromptTemplateDefinition; markdown: string; options: Record<string, PromptOptionValue>; edited: boolean }
export function resolvePromptTemplate(selection: PromptTemplateSelection, operation: PromptOperation): ResolvedPromptTemplate {
  const definition = findPromptTemplate(selection.id, selection.version);
  if (!definition) throw Error(`PROMPT_TEMPLATE_NOT_FOUND: ${selection.id}@${selection.version}`);
  if (definition.operation !== operation) throw Error(`PROMPT_TEMPLATE_OPERATION: ${definition.id} is a ${definition.operation} template`);
  const markdown = selection.markdown ?? definition.markdown;
  const issues = validateTemplateMarkdown(definition, markdown);
  if (issues.length) throw Error(`PROMPT_TEMPLATE_INVALID: ${issues.map(issue => issue.message).join(' ')}`);
  return { definition, markdown, options: normalizePromptOptions(definition, selection.options), edited: selection.markdown !== undefined && selection.markdown !== definition.markdown };
}

/** Fields are inserted verbatim; callers encode untrusted values (e.g. as JSON) before rendering. */
export function renderPromptTemplate(template: { markdown: string; options: PromptOptions; parameters: readonly GenerationPromptParameter[] }, fields: Readonly<Record<typeof requiredPromptFields[number], string>>) {
  return template.markdown.replace(placeholder, (_, key: string) => {
    if (key.startsWith('options.')) {
      const parameter = template.parameters.find(parameter => parameter.key === key.slice(8));
      if (!parameter) throw Error(`Unknown prompt template option: ${key}`);
      const value = template.options[parameter.key];
      return parameter.kind === 'enum' ? parameter.options.find(option => option.value === value)?.guidance ?? String(value) : String(value);
    }
    if (!(key in fields)) throw Error(`Unknown prompt template field: ${key}`);
    return fields[key as keyof typeof fields];
  });
}
