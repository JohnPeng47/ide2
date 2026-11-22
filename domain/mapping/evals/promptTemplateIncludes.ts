import { tokenizeTemplate } from './promptTemplate';

/** Executable stages and, for stages with includes, the author's original text. */
export interface PromptTemplateSources {
  stages: Record<string, string>;
  templateSources?: Record<string, string>;
}

export const promptTemplateToken = (id: string) => `{{template:${id}}}`;
export const validPromptTemplateId = (id: string) => /^prompt-snippets\/[a-z0-9][a-z0-9_-]*\.txt$/.test(id);
export const includedTemplateId = (name?: string) => name?.startsWith('template:') ? name.slice('template:'.length).trim() : undefined;
export function promptTemplateIds(body: string) {
  return [...new Set(tokenizeTemplate(body).flatMap(token => {
    const id = includedTemplateId(token.name);
    return id === undefined ? [] : [id];
  }))];
}
export function authoredStages(prompt: PromptTemplateSources) {
  return { ...prompt.stages, ...prompt.templateSources };
}

/** An unchanged authored stage reuses the exact expansion from its parent version. */
export function expandPromptStage(stage: string, body: string, templates: ReadonlyMap<string, string>, parent?: PromptTemplateSources) {
  if (parent?.templateSources?.[stage] === body) return parent.stages[stage];
  let length = 0;
  return tokenizeTemplate(body).map(token => {
    const id = includedTemplateId(token.name);
    const text = id === undefined ? token.text : templates.get(id);
    if (text === undefined) throw Error(`Unknown prompt template "${id}".`);
    length += text.length;
    if (length > 50000) throw Error('Expanded prompt stage exceeds 50,000 characters.');
    return text;
  }).join('');
}
