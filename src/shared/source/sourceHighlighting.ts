import type { TokensResult } from "shiki";
import type { ContentPresentation } from "../../../domain/core/profiles/domainProfile";

const SHIKI_THEME = "dark-plus";
const TOKEN_CACHE_LIMIT = 40;

const LANGUAGE_BY_EXTENSION: Record<string, { id: string; name: string }> = {
  c: { id: "c", name: "C" },
  cc: { id: "cpp", name: "C++" },
  cjs: { id: "javascript", name: "JavaScript" },
  cpp: { id: "cpp", name: "C++" },
  cs: { id: "csharp", name: "C#" },
  css: { id: "css", name: "CSS" },
  cts: { id: "typescript", name: "TypeScript" },
  dockerfile: { id: "dockerfile", name: "Dockerfile" },
  go: { id: "go", name: "Go" },
  h: { id: "c", name: "C" },
  hpp: { id: "cpp", name: "C++" },
  html: { id: "html", name: "HTML" },
  java: { id: "java", name: "Java" },
  js: { id: "javascript", name: "JavaScript" },
  json: { id: "json", name: "JSON" },
  jsonc: { id: "jsonc", name: "JSON with Comments" },
  jsx: { id: "jsx", name: "JSX" },
  less: { id: "less", name: "Less" },
  lua: { id: "lua", name: "Lua" },
  makefile: { id: "makefile", name: "Makefile" },
  md: { id: "markdown", name: "Markdown" },
  mjs: { id: "javascript", name: "JavaScript" },
  mts: { id: "typescript", name: "TypeScript" },
  php: { id: "php", name: "PHP" },
  ps1: { id: "powershell", name: "PowerShell" },
  py: { id: "python", name: "Python" },
  pyi: { id: "python", name: "Python" },
  pyw: { id: "python", name: "Python" },
  rb: { id: "ruby", name: "Ruby" },
  rs: { id: "rust", name: "Rust" },
  sass: { id: "sass", name: "Sass" },
  scss: { id: "scss", name: "SCSS" },
  sh: { id: "bash", name: "Shell" },
  sql: { id: "sql", name: "SQL" },
  svelte: { id: "svelte", name: "Svelte" },
  swift: { id: "swift", name: "Swift" },
  toml: { id: "toml", name: "TOML" },
  ts: { id: "typescript", name: "TypeScript" },
  tsx: { id: "tsx", name: "TSX" },
  vue: { id: "vue", name: "Vue" },
  xml: { id: "xml", name: "XML" },
  yaml: { id: "yaml", name: "YAML" },
  yml: { id: "yaml", name: "YAML" },
  zig: { id: "zig", name: "Zig" },
  zsh: { id: "zsh", name: "Zsh" }
};

const tokenCache = new Map<string, Promise<TokensResult>>();

function languageKey(path: string): string {
  const filename = path.split(/[\\/]/).at(-1)?.toLowerCase() ?? "";
  if (filename in LANGUAGE_BY_EXTENSION) return filename;
  return filename.includes(".") ? filename.split(".").at(-1) ?? "" : filename;
}

function languageForPath(path: string): { id: string; name: string } {
  return LANGUAGE_BY_EXTENSION[languageKey(path)] ?? { id: "text", name: "Plain text" };
}

export function sourceLanguageName(path: string): string {
  return languageForPath(path).name;
}

export function contentLanguageName(path: string, presentation: ContentPresentation): string {
  return presentation.syntaxHighlighting === "code" ? sourceLanguageName(path) : "Plain text";
}

export async function tokenizeSource(path: string, source: string): Promise<TokensResult> {
  const configuredLanguage = LANGUAGE_BY_EXTENSION[languageKey(path)]?.id;
  const candidateLanguage = configuredLanguage ?? languageKey(path);
  const key = `${SHIKI_THEME}\0${candidateLanguage}\0${source}`;
  const cached = tokenCache.get(key);
  if (cached) return cached;

  const pending = import("shiki").then(({ bundledLanguagesInfo, codeToTokens }) => {
    const bundledLanguage = bundledLanguagesInfo.find((language) => (
      language.id === candidateLanguage || language.aliases?.includes(candidateLanguage)
    ));
    const language = configuredLanguage ?? bundledLanguage?.id ?? "text";
    return codeToTokens(source, {
      lang: language as Parameters<typeof codeToTokens>[1]["lang"],
      theme: SHIKI_THEME
    });
  });
  tokenCache.set(key, pending);
  if (tokenCache.size > TOKEN_CACHE_LIMIT) {
    const oldest = tokenCache.keys().next().value;
    if (oldest !== undefined) tokenCache.delete(oldest);
  }
  pending.catch(() => tokenCache.delete(key));
  return pending;
}

