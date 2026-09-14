import {
  lstat,
  readdir,
  readFile,
  realpath,
  stat
} from "node:fs/promises";
import path from "node:path";
import type { SourceRange } from "../../src/core/domain";
import type { CorpusBinding, CorpusDirectoryListing, CorpusProvider } from "../../src/core/domainProfile";

function relativeSegments(value: string, label: string): string[] {
  if (value.includes("\0") || value.includes("\\")) {
    throw new Error(`${label} path is invalid`);
  }
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
    throw new Error(`${label} path must be relative`);
  }
  const segments = value === "" ? [] : value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`${label} path is invalid`);
  }
  return segments;
}

async function canonicalBindingRoot(binding: CorpusBinding, expectedKind: CorpusBinding["kind"]): Promise<string> {
  if (binding.kind !== expectedKind) {
    throw new Error(`corpus provider ${expectedKind} cannot read ${binding.kind}`);
  }
  const root = await realpath(binding.root).catch(() => null);
  if (!root || !(await stat(root)).isDirectory()) {
    throw new Error(`corpus root is not a directory: ${path.resolve(binding.root)}`);
  }
  return root;
}

async function resolveWithoutSymlinks(
  root: string,
  relativePath: string,
  label: string
): Promise<string> {
  const segments = relativeSegments(relativePath, label);
  let resolved = root;
  for (const segment of segments) {
    resolved = path.join(resolved, segment);
    const info = await lstat(resolved).catch(() => null);
    if (!info) throw new Error(`unknown ${label} path: ${relativePath}`);
    if (info.isSymbolicLink()) {
      throw new Error(label === "corpus directory"
        ? "symbolic-link directories cannot be traversed"
        : "symbolic-link corpus file paths cannot be traversed");
    }
  }
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${label} path escapes corpus root`);
  }
  return resolved;
}

class FilesystemCorpusProvider implements CorpusProvider {
  constructor(readonly kind: CorpusBinding["kind"]) {}

  async listDirectory(
    binding: CorpusBinding,
    directory: string
  ): Promise<CorpusDirectoryListing> {
    const root = await canonicalBindingRoot(binding, this.kind);
    const directoryPath = await resolveWithoutSymlinks(root, directory, "corpus directory");
    if (!(await stat(directoryPath)).isDirectory()) {
      throw new Error(`corpus path is not a directory: ${directory}`);
    }
    const entries = (await readdir(directoryPath, { withFileTypes: true }))
      .filter((entry) => entry.name !== ".git")
      .map((entry) => ({
        path: path.relative(root, path.join(directoryPath, entry.name)).split(path.sep).join("/"),
        name: entry.name,
        kind: entry.isDirectory() && !entry.isSymbolicLink()
          ? "directory" as const
          : "file" as const
      }))
      .sort((left, right) => (
        (left.kind === right.kind ? 0 : left.kind === "directory" ? -1 : 1)
        || left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
        || left.path.localeCompare(right.path)
      ));
    return { directory: relativeSegments(directory, "corpus directory").join("/"), entries };
  }

  async readLines(binding: CorpusBinding, range: SourceRange): Promise<string[]> {
    if (!Number.isInteger(range.startLine) || !Number.isInteger(range.endLine)
      || range.startLine < 1 || range.endLine < range.startLine) {
      throw new Error(`invalid evidence range for ${range.path}`);
    }
    const lines = await this.readDocumentLines(binding, range.path);
    return lines.slice(range.startLine - 1, Math.min(range.endLine, lines.length));
  }

  async readDocumentLines(binding: CorpusBinding, relativePath: string): Promise<string[]> {
    return (await this.readDocumentText(binding, relativePath)).split(/\r?\n/);
  }

  async readDocumentText(binding: CorpusBinding, relativePath: string): Promise<string> {
    return (await this.readDocumentBytes(binding, relativePath)).toString("utf8");
  }

  async readDocumentBytes(binding: CorpusBinding, relativePath: string): Promise<Buffer> {
    const root = await canonicalBindingRoot(binding, this.kind);
    const filePath = await resolveWithoutSymlinks(root, relativePath, "corpus file");
    if (!(await stat(filePath)).isFile()) throw new Error(`corpus path is not a file: ${relativePath}`);
    return readFile(filePath);
  }
}

export type ReadableCorpusProvider = CorpusProvider & {
  readDocumentBytes(binding: CorpusBinding, relativePath: string): Promise<Buffer>;
  readDocumentText(binding: CorpusBinding, relativePath: string): Promise<string>;
  readDocumentLines(binding: CorpusBinding, relativePath: string): Promise<string[]>;
};

const providers: Record<CorpusBinding["kind"], ReadableCorpusProvider> = {
  "git-worktree": new FilesystemCorpusProvider("git-worktree"),
  "filesystem-documents": new FilesystemCorpusProvider("filesystem-documents")
};

export function corpusProvider(binding: CorpusBinding): ReadableCorpusProvider {
  return providers[binding.kind];
}

export async function readCorpusDocumentLines(
  binding: CorpusBinding,
  relativePath: string
): Promise<string[]> {
  return corpusProvider(binding).readDocumentLines(binding, relativePath);
}
