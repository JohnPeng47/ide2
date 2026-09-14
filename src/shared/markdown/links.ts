import type { Token } from "markdown-it";

export const TERMINAL_MARKDOWN_OPEN_FILE_MESSAGE = "new-diagram:open-repository-file";
export const TERMINAL_MARKDOWN_REVEAL_LINE_MESSAGE = "new-diagram:reveal-markdown-line";
export const TERMINAL_MARKDOWN_ACTIVE_SECTION_MESSAGE = "new-diagram:active-markdown-section";

export function decorateMarkdownLinks(tokens: Token[], documentPath: string): void {
  for (const token of tokens) {
    if (token.type === "link_open") decorateLink(token, documentPath);
    if (token.children) decorateMarkdownLinks(token.children, documentPath);
  }
}

function decorateLink(token: Token, documentPath: string): void {
  const href = token.attrGet("href");
  if (href === null || href === undefined) return;
  const target = String(href);
  if (!target || target.startsWith("#")) return;

  const externalUrl = absoluteHttpUrl(target);
  if (externalUrl) {
    token.attrSet("href", externalUrl);
    token.attrSet("target", "_blank");
    token.attrSet("rel", "noopener noreferrer");
    token.attrJoin("class", "external-ref");
    return;
  }

  const repositoryPath = resolveRepositoryReference(documentPath, target);
  if (!repositoryPath) {
    token.attrSet("href", "#");
    token.attrSet("aria-disabled", "true");
    return;
  }
  token.attrSet("href", `#repository:${encodeURIComponent(repositoryPath)}`);
  token.attrSet("data-repository-path", repositoryPath);
  token.attrJoin("class", "repository-ref");
}

export function resolveRepositoryReference(documentPath: string, target: string): string | null {
  if (!documentPath || !target || target.includes("\0") || target.includes("\\")) return null;
  const withoutFragment = target.split(/[?#]/, 1)[0];
  if (!withoutFragment || withoutFragment.startsWith("/") || /^[a-z][a-z\d+.-]*:/i.test(withoutFragment)) {
    return null;
  }
  const segments = documentPath.split("/").slice(0, -1);
  for (const segment of withoutFragment.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments.length > 0 ? segments.join("/") : null;
}

function absoluteHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function terminalRepositoryLinkController(): string {
  return `<script>
(() => {
  document.addEventListener('click', (event) => {
    const link = event.target instanceof Element
      ? event.target.closest('[data-repository-path]')
      : null;
    if (!link) return;
    event.preventDefault();
    parent.postMessage({
      type: '${TERMINAL_MARKDOWN_OPEN_FILE_MESSAGE}',
      path: link.getAttribute('data-repository-path')
    }, '*');
  });
  window.addEventListener('message', (event) => {
    if (event.source !== parent
      || !event.data
      || event.data.type !== '${TERMINAL_MARKDOWN_REVEAL_LINE_MESSAGE}'
      || !Number.isInteger(event.data.line)
      || event.data.line < 1) return;
    const line = event.data.line;
    const selectionStart = Number.isInteger(event.data.startLine) ? event.data.startLine : line;
    const selectionEnd = Number.isInteger(event.data.endLine) ? event.data.endLine : selectionStart;
    const candidates = [...document.querySelectorAll('[data-source-start-line]')]
      .map((element) => ({
        element,
        start: Number(element.getAttribute('data-source-start-line')),
        end: Number(element.getAttribute('data-source-end-line'))
      }))
      .filter(({ start, end }) => Number.isFinite(start) && Number.isFinite(end));
    document.querySelectorAll('.is-source-selection').forEach((element) => {
      element.classList.remove('is-source-selection');
    });
    const intersecting = candidates.filter(({ start, end }) => (
      start <= selectionEnd && selectionStart <= end
    ));
    const leafBlocks = intersecting.filter(({ element }) => ![...element.children].some((child) => (
      child.matches('[data-source-start-line]')
      && Number(child.getAttribute('data-source-start-line')) <= selectionEnd
      && selectionStart <= Number(child.getAttribute('data-source-end-line'))
    )));
    leafBlocks.forEach(({ element }) => element.classList.add('is-source-selection'));
    const containing = candidates
      .filter(({ start, end }) => start <= line && line <= end)
      .sort((left, right) => (left.end - left.start) - (right.end - right.start));
    const preceding = candidates
      .filter(({ start }) => start <= line)
      .sort((left, right) => right.start - left.start);
    const following = candidates
      .filter(({ start }) => start > line)
      .sort((left, right) => left.start - right.start);
    const target = containing[0] ?? preceding[0] ?? following[0];
    const behavior = event.data.behavior === 'smooth'
      && !matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'smooth'
      : 'auto';
    target?.element.scrollIntoView({ block: 'start', behavior });
  });

  let sectionFrame = 0;
  const reportActiveSection = () => {
    sectionFrame = 0;
    const headings = [...document.querySelectorAll('h2[id], h3[id], h4[id]')];
    if (headings.length === 0) return;
    const threshold = Math.max(24, innerHeight * 0.12);
    const preceding = headings.filter((heading) => heading.getBoundingClientRect().top <= threshold);
    const active = preceding.at(-1) ?? headings[0];
    parent.postMessage({
      type: '${TERMINAL_MARKDOWN_ACTIVE_SECTION_MESSAGE}',
      id: active.id,
      line: Number(active.getAttribute('data-source-start-line')),
      scrollTop: scrollY
    }, '*');
  };
  addEventListener('scroll', () => {
    if (!sectionFrame) sectionFrame = requestAnimationFrame(reportActiveSection);
  }, { passive: true });
  addEventListener('load', reportActiveSection, { once: true });
  requestAnimationFrame(reportActiveSection);
})();
</script>`;
}
