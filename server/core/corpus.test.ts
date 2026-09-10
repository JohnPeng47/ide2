import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  afterEach,
  describe,
  expect,
  it
} from "vitest";
import { corpusProvider } from "./corpus";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("filesystem corpus providers", () => {
  it("lists and reads document corpora without permitting traversal or symlink escapes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-doc-corpus-"));
    const outside = await mkdtemp(path.join(tmpdir(), "new-diagram-doc-outside-"));
    roots.push(root, outside);
    await mkdir(path.join(root, "notes"));
    await writeFile(path.join(root, "notes", "interview.txt"), "one\ntwo\nthree\n", "utf8");
    await writeFile(path.join(outside, "secret.txt"), "secret\n", "utf8");
    await symlink(outside, path.join(root, "linked"));
    const binding = { kind: "filesystem-documents" as const, root };
    const provider = corpusProvider(binding);

    await expect(provider.listDirectory(binding, "")).resolves.toEqual({
      directory: "",
      entries: [
        { path: "notes", name: "notes", kind: "directory" },
        { path: "linked", name: "linked", kind: "file" }
      ]
    });
    await expect(provider.readLines(binding, {
      path: "notes/interview.txt",
      startLine: 2,
      endLine: 3
    })).resolves.toEqual(["two", "three"]);
    await expect(provider.readLines(binding, {
      path: "../secret.txt",
      startLine: 1,
      endLine: 1
    })).rejects.toThrow(/invalid/);
    await expect(provider.listDirectory(binding, "linked")).rejects.toThrow(/symbolic-link/);
  });
});
