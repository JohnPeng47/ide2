import type { Token } from 'markdown-it';

export interface TerminalMarkdownHeading {
  id: string;
  label: string;
  level: 2 | 3 | 4;
  startLine: number;
}

export interface TerminalMarkdownSection extends TerminalMarkdownHeading {
  endLine: number;
}

export interface TerminalMarkdownOutline {
  title: string;
  sections: TerminalMarkdownSection[];
}

export function decorateTerminalMarkdownHeadings(
  tokens: Token[],
): TerminalMarkdownHeading[] {
  const headings: TerminalMarkdownHeading[] = [];
  const slugCounts = new Map<string, number>();

  for (let index = 0; index < tokens.length - 1; index += 1) {
    const opening = tokens[index];
    const level = headingLevel(opening);
    if (!level) continue;

    const inline = tokens[index + 1];
    if (inline.type !== 'inline') continue;
    const label = inlineText(inline);
    const base = slugifyHeading(label);
    const count = (slugCounts.get(base) ?? 0) + 1;
    slugCounts.set(base, count);
    const id = count === 1 ? base : `${base}-${count}`;

    opening.attrSet('id', id);
    opening.attrSet('tabindex', '-1');
    headings.push({
      id,
      label,
      level,
      startLine: opening.map ? opening.map[0] + 2 : 1
    });
  }

  return headings;
}

export function renderTerminalMarkdownToc(
  headings: readonly TerminalMarkdownHeading[],
): string {
  if (headings.length === 0) return '';
  const links = headings.map(({ id, label, level }) => `
      <li>
        <a class="terminal-toc-link is-level-${level}" href="#${escapeAttribute(id)}">
          ${escapeHtml(label)}
        </a>
      </li>`).join('');

  return `<nav class="terminal-toc" data-terminal-toc data-cms-static-ui aria-label="Table of contents">
  <div class="terminal-toc-track" aria-hidden="true">
    <span class="terminal-toc-progress"></span>
  </div>
  <div class="terminal-toc-content">
    <div class="terminal-toc-heading">contents</div>
    <ol>${links}
    </ol>
  </div>
</nav>`;
}

function headingLevel(token: Token): TerminalMarkdownHeading['level'] | null {
  if (token.type !== 'heading_open') return null;
  if (token.tag === 'h2') return 2;
  if (token.tag === 'h3') return 3;
  if (token.tag === 'h4') return 4;
  return null;
}

function inlineText(token: Token): string {
  const text = (token.children ?? []).map((child) => {
    if (child.type === 'text' || child.type === 'code_inline' || child.type === 'image') {
      return child.content;
    }
    if (child.type === 'softbreak' || child.type === 'hardbreak') return ' ';
    return '';
  }).join('');
  return text.replace(/\s+/g, ' ').trim() || 'Section';
}

function slugifyHeading(label: string): string {
  const slug = label
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'section';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;');
}
