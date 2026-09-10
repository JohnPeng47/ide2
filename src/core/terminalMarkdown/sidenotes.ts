import type {
  Env,
  MarkdownIt,
  StateCore,
  Token
} from 'markdown-it';

export interface TerminalSidenote {
  id: string;
  markdown: string;
  html: string;
}

export interface TerminalSidenoteEnvironment extends Env {
  sidenotes: ReadonlyMap<string, TerminalSidenote>;
  sidenoteReferenceCounts: Map<string, number>;
}

interface SidenoteDefinition {
  id: string;
  markdown: string;
}

export function installTerminalSidenotes(markdown: MarkdownIt): void {
  markdown.core.ruler.after('inline', 'terminal_sidenote_refs', transformSidenoteReferences);
  markdown.renderer.rules.terminal_sidenote_ref = renderSidenoteReference;
}

export function extractTerminalSidenotes(markdown: string): {
  markdown: string;
  definitions: SidenoteDefinition[];
} {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const sectionIndexes = lines
    .map((line, index) => (line.trim() === '# Sidenotes' ? index : -1))
    .filter((index) => index >= 0);
  if (sectionIndexes.length === 0) return { markdown, definitions: [] };
  if (sectionIndexes.length > 1) {
    throw new Error('Terminal Markdown may only contain one # Sidenotes section');
  }

  const sectionIndex = sectionIndexes[0];
  const definitions: Array<{ id: string; lines: string[] }> = [];
  const ids = new Set<string>();
  let current: { id: string; lines: string[] } | null = null;

  for (const line of lines.slice(sectionIndex + 1)) {
    const match = /^\[(\d+)\]\s+(.+)$/.exec(line);
    if (match) {
      const id = String(Number(match[1]));
      if (id === '0') throw new Error('Sidenote identifiers must be positive integers');
      if (ids.has(id)) throw new Error(`Duplicate sidenote definition: ${id}`);
      ids.add(id);
      current = { id, lines: [match[2]] };
      definitions.push(current);
      continue;
    }
    if (!current) {
      if (line.trim()) {
        throw new Error('Sidenote content must begin with a numbered definition');
      }
      continue;
    }
    current.lines.push(line);
  }

  return {
    markdown: lines.slice(0, sectionIndex).join('\n').trimEnd(),
    definitions: definitions.map(({ id, lines: definitionLines }) => {
      const definition = definitionLines.join('\n').trim();
      if (!definition) throw new Error(`Sidenote ${id} is empty`);
      return { id, markdown: definition };
    }),
  };
}

export function renderTerminalSidenoteRail(
  sidenotes: readonly TerminalSidenote[],
): string {
  if (sidenotes.length === 0) return '';
  const cards = sidenotes.map((sidenote) => `
    <li
      class="terminal-sidenote-card"
      id="terminal-sidenote-card-${sidenote.id}"
      data-sidenote-card="${sidenote.id}"
    >
      <span class="terminal-sidenote-number" aria-hidden="true">${sidenote.id}</span>
      <div class="terminal-sidenote-copy">${sidenote.html}</div>
    </li>`).join('');
  return `<aside
  class="terminal-sidenotes"
  data-terminal-sidenotes
  data-cms-static-ui
  aria-label="Sidenotes"
>
  <div class="terminal-sidenotes-heading">sidenotes</div>
  <ol>${cards}
  </ol>
</aside>`;
}

export function terminalSidenoteController(): string {
  return `<script>
(() => {
  const rail = document.querySelector('[data-terminal-sidenotes]');
  if (!rail) return;
  const refs = Array.from(document.querySelectorAll('[data-sidenote-ref]'));
  const cards = Array.from(rail.querySelectorAll('[data-sidenote-card]'));
  const inlineMode = matchMedia('(max-width: 1100px)');
  let pinnedId = null;

  const activate = (id) => {
    cards.forEach((card) => card.classList.toggle(
      'is-active',
      id !== null && card.dataset.sidenoteCard === id
    ));
    refs.forEach((ref) => ref.classList.toggle(
      'is-active',
      id !== null && ref.dataset.sidenoteRef === id
    ));
  };

  const closeInlineNotes = (except) => {
    document.querySelectorAll('[data-sidenote-inline]').forEach((note) => {
      if (note === except) return;
      note.hidden = true;
    });
    refs.forEach((ref) => {
      const inlineId = ref.getAttribute('data-sidenote-inline-target');
      ref.setAttribute(
        'aria-expanded',
        String(Boolean(inlineId && !document.getElementById(inlineId)?.hidden))
      );
    });
  };

  refs.forEach((ref) => {
    const id = ref.dataset.sidenoteRef;
    ref.addEventListener('mouseenter', () => {
      if (!inlineMode.matches) activate(id);
    });
    ref.addEventListener('mouseleave', () => {
      if (!inlineMode.matches) activate(pinnedId);
    });
    ref.addEventListener('focus', () => {
      if (!inlineMode.matches) activate(id);
    });
    ref.addEventListener('blur', () => {
      if (!inlineMode.matches) activate(pinnedId);
    });
    ref.addEventListener('click', () => {
      if (inlineMode.matches) {
        const inlineId = ref.getAttribute('data-sidenote-inline-target');
        const note = inlineId ? document.getElementById(inlineId) : null;
        if (!note) return;
        const opening = note.hidden;
        closeInlineNotes(note);
        note.hidden = !opening;
        ref.setAttribute('aria-expanded', String(opening));
        return;
      }
      pinnedId = pinnedId === id ? null : id;
      activate(pinnedId);
      if (pinnedId) {
        rail.querySelector('[data-sidenote-card="' + pinnedId + '"]')
          ?.scrollIntoView({ block: 'nearest' });
      }
    });
  });

  inlineMode.addEventListener('change', () => {
    pinnedId = null;
    activate(null);
    closeInlineNotes(null);
  });
})();
</script>`;
}

function transformSidenoteReferences(state: StateCore): void {
  for (const blockToken of state.tokens) {
    if (blockToken.type !== 'inline' || !blockToken.children) continue;
    const transformed: Token[] = [];
    let linkDepth = 0;

    for (const token of blockToken.children) {
      if (token.type === 'link_open') linkDepth += 1;
      if (token.type !== 'text' || linkDepth > 0) {
        transformed.push(token);
      } else {
        transformed.push(...splitSidenoteReferences(state, token));
      }
      if (token.type === 'link_close') linkDepth -= 1;
    }
    blockToken.children = transformed;
  }
}

function splitSidenoteReferences(state: StateCore, token: Token): Token[] {
  const pattern = /\((\d+)\)\[footer\]/g;
  const split: Token[] = [];
  let cursor = 0;

  for (const match of token.content.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      const text = new state.Token('text', '', 0);
      text.content = token.content.slice(cursor, index);
      split.push(text);
    }
    const reference = new state.Token('terminal_sidenote_ref', '', 0);
    reference.meta = { id: String(Number(match[1])) };
    split.push(reference);
    cursor = index + match[0].length;
  }
  if (split.length === 0) return [token];
  if (cursor < token.content.length) {
    const text = new state.Token('text', '', 0);
    text.content = token.content.slice(cursor);
    split.push(text);
  }
  return split;
}

function renderSidenoteReference(
  tokens: Token[],
  index: number,
  _options: unknown,
  environment: Env | undefined,
): string {
  const terminalEnvironment = environment as TerminalSidenoteEnvironment;
  const id = String(tokens[index].meta?.id ?? '');
  const sidenote = terminalEnvironment.sidenotes.get(id);
  if (!sidenote) throw new Error(`Missing sidenote definition: ${id}`);
  const count = (terminalEnvironment.sidenoteReferenceCounts.get(id) ?? 0) + 1;
  terminalEnvironment.sidenoteReferenceCounts.set(id, count);
  const inlineId = `terminal-sidenote-inline-${id}-${count}`;
  const cardId = `terminal-sidenote-card-${id}`;

  return `<sup class="terminal-sidenote-marker">
  <button
    type="button"
    class="terminal-sidenote-ref"
    data-sidenote-ref="${id}"
    data-sidenote-inline-target="${inlineId}"
    aria-label="Sidenote ${id}"
    aria-controls="${cardId} ${inlineId}"
    aria-describedby="${cardId}"
    aria-expanded="false"
  >${id}</button>
</sup><span
  class="terminal-sidenote-inline"
  id="${inlineId}"
  data-sidenote-inline="${id}"
  hidden
><span class="terminal-sidenote-inline-number" aria-hidden="true">${id}</span>${sidenote.html}</span>`;
}
