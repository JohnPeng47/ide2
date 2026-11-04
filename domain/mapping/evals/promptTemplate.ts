/** `{{ name }}` placeholders and `{{ref:id}}` reference citations. Everything else is literal prompt text. */
export interface TemplateToken { kind: 'text' | 'variable'; text: string; name?: string; start: number; end: number;
  /** Set for `{{ref:id}}` tokens: the cited reference's ID. */
  reference?: string }
export interface TemplateIssue { severity: 'error' | 'warning'; message: string; start?: number; end?: number }
export interface TemplateVariable { name: string }

const placeholder = /\{\{\s*([^{}]*?)\s*\}\}/g;
const validName = /^[a-z][a-z0-9_]*$/;
const referenceName = /^ref:\s*(.*)$/;
const validReference = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function tokenizeTemplate(body: string): TemplateToken[] {
  const tokens: TemplateToken[] = [];
  let cursor = 0;
  for (const match of body.matchAll(placeholder)) {
    const start = match.index!, end = start + match[0].length;
    if (start > cursor) tokens.push({ kind: 'text', text: body.slice(cursor, start), start: cursor, end: start });
    const reference = match[1].match(referenceName)?.[1];
    tokens.push({ kind: 'variable', text: match[0], name: match[1], start, end, ...(reference !== undefined ? { reference } : {}) });
    cursor = end;
  }
  if (cursor < body.length) tokens.push({ kind: 'text', text: body.slice(cursor), start: cursor, end: body.length });
  return tokens;
}

export const templateVariables = (body: string) =>
  [...new Set(tokenizeTemplate(body).flatMap(token => token.kind === 'variable' && token.reference === undefined ? [token.name!] : []))];
export const templateReferences = (body: string) =>
  [...new Set(tokenizeTemplate(body).flatMap(token => token.reference !== undefined ? [token.reference] : []))];
/** The value key a rendered `{{ref:id}}` reads. */
export const referenceKey = (id: string) => `ref:${id}`;

/** `references`, when given, is the set of IDs that exist; otherwise only their syntax is checked. */
export function validateTemplate(body: string, variables: TemplateVariable[], references?: ReadonlySet<string>): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  if (!body.trim()) issues.push({ severity: 'error', message: 'The prompt is empty.' });
  const known = new Set(variables.map(variable => variable.name));
  for (const token of tokenizeTemplate(body)) {
    if (token.kind === 'variable' && token.reference !== undefined) {
      if (!validReference.test(token.reference)) issues.push({ severity: 'error', message: `Invalid reference “${token.reference}”. Pick one from the References list.`, start: token.start, end: token.end });
      else if (references && !references.has(token.reference)) issues.push({ severity: 'error', message: `Unknown reference {{ref:${token.reference}}}.`, start: token.start, end: token.end });
      continue;
    }
    if (token.kind === 'variable') {
      if (!validName.test(token.name!)) issues.push({ severity: 'error', message: `Invalid variable name “${token.name}”. Use lowercase letters, digits and underscores.`, start: token.start, end: token.end });
      else if (!known.has(token.name!)) issues.push({ severity: 'error', message: `Unknown variable {{${token.name}}}.`, start: token.start, end: token.end });
      continue;
    }
    // Unmatched braces are almost always a typo of a placeholder.
    const open = token.text.indexOf('{{');
    if (open >= 0) issues.push({ severity: 'warning', message: 'Unclosed “{{”. Close it with “}}” or remove it.', start: token.start + open, end: token.start + open + 2 });
    // Adjacent closing braces are valid in the explicit JSON output examples in prompts.
  }
  return issues;
}

export function renderTemplate(body: string, values: Record<string, string>) {
  return tokenizeTemplate(body).map(token => {
    if (token.kind === 'text') return token.text;
    const key = token.reference !== undefined ? referenceKey(token.reference) : token.name!;
    if (!Object.hasOwn(values, key)) throw Error(`Missing value for {{${key}}}`);
    return values[key];
  }).join('');
}
