/** `{{ name }}` placeholders. Everything else is literal prompt text. */
export interface TemplateToken { kind: 'text' | 'variable'; text: string; name?: string; start: number; end: number }
export interface TemplateIssue { severity: 'error' | 'warning'; message: string; start?: number; end?: number }
export interface TemplateVariable { name: string }

const placeholder = /\{\{\s*([^{}]*?)\s*\}\}/g;
const validName = /^[a-z][a-z0-9_]*$/;

export function tokenizeTemplate(body: string): TemplateToken[] {
  const tokens: TemplateToken[] = [];
  let cursor = 0;
  for (const match of body.matchAll(placeholder)) {
    const start = match.index!, end = start + match[0].length;
    if (start > cursor) tokens.push({ kind: 'text', text: body.slice(cursor, start), start: cursor, end: start });
    tokens.push({ kind: 'variable', text: match[0], name: match[1], start, end });
    cursor = end;
  }
  if (cursor < body.length) tokens.push({ kind: 'text', text: body.slice(cursor), start: cursor, end: body.length });
  return tokens;
}

export const templateVariables = (body: string) =>
  [...new Set(tokenizeTemplate(body).flatMap(token => token.kind === 'variable' ? [token.name!] : []))];

export function validateTemplate(body: string, variables: TemplateVariable[]): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  if (!body.trim()) issues.push({ severity: 'error', message: 'The prompt is empty.' });
  const known = new Set(variables.map(variable => variable.name));
  for (const token of tokenizeTemplate(body)) {
    if (token.kind === 'variable') {
      if (!validName.test(token.name!)) issues.push({ severity: 'error', message: `Invalid variable name “${token.name}”. Use lowercase letters, digits and underscores.`, start: token.start, end: token.end });
      else if (!known.has(token.name!)) issues.push({ severity: 'error', message: `Unknown variable {{${token.name}}}.`, start: token.start, end: token.end });
      continue;
    }
    // Unmatched braces are almost always a typo of a placeholder.
    const open = token.text.indexOf('{{'), close = token.text.indexOf('}}');
    if (open >= 0) issues.push({ severity: 'warning', message: 'Unclosed “{{”. Close it with “}}” or remove it.', start: token.start + open, end: token.start + open + 2 });
    if (close >= 0) issues.push({ severity: 'warning', message: 'Unmatched “}}”.', start: token.start + close, end: token.start + close + 2 });
  }
  return issues;
}

export function renderTemplate(body: string, values: Record<string, string>) {
  return tokenizeTemplate(body).map(token => {
    if (token.kind === 'text') return token.text;
    if (!Object.hasOwn(values, token.name!)) throw Error(`Missing value for {{${token.name}}}`);
    return values[token.name!];
  }).join('');
}
