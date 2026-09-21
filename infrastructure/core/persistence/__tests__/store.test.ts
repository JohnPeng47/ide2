import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
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
import { resolveDiagramSource } from '../../../../application/core/source/diagramSource';
import { sourceBindingFromLocation } from '../../../../domain/core/diagrams/diagram';
import { SCHEMA_VERSION } from "../../../../domain/core/records/domain";
import { DiagramStore } from "../store";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("DiagramStore", () => {

  it("does not implicitly migrate unrelated legacy projects", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-legacy-project-"));
    roots.push(root);
    await mkdir(path.join(root, ".diagrams"));
    await writeFile(path.join(root, ".diagrams", "project.json"), JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      id: "project-legacy",
      name: "Legacy",
      repositoryIdentity: path.join(root, ".git"),
      canonicalRepoRoot: root,
      diagramSetIds: [],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z"
    }));

    await expect(new DiagramStore(root).loadProject()).resolves.toMatchObject({
      id: "project-legacy", canonicalRepoRoot: root
    });
  });

  it("persists a document profile and filesystem corpus for a non-git directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-document-project-"));
    roots.push(root);
    const store = new DiagramStore(root);
    const location = {
      checkoutRoot: root,
      repositoryIdentity: `filesystem-documents:${root}`,
      domainProfileId: "document" as const,
      corpus: { kind: "filesystem-documents" as const, root }
    };
    const project = await store.ensureProject(location);

    expect(project).toMatchObject({ defaultDomainProfileId: "document" });
    expect(project).not.toHaveProperty("corpus");
    await expect(readFile(path.join(root, ".diagrams", "project.json"), "utf8"))
      .resolves.toContain('"defaultDomainProfileId": "document"');
  });

  it("writes to a caller-selected diagrams directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "new-diagram-store-root-"));
    roots.push(root);
    await mkdir(path.join(root, ".git"));
    const store = new DiagramStore(root, ".new_diagrams");
    const location = { checkoutRoot: root, repositoryIdentity: path.join(root, ".git") };
    await store.ensureProject(location);

    expect(store.storeRoot).toBe(path.join(root, ".new_diagrams"));
    const project = JSON.parse(await readFile(
      path.join(root, ".new_diagrams", "project.json"),
      "utf8"
    )) as { repositoryIdentity: string };
    expect(project.repositoryIdentity).toBeUndefined();
  });
});

it('migrates legacy source registrations once without modifying catalogs or set records', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mapping-legacy-sources-')); roots.push(root);
  const store = new DiagramStore(root);
  const original = await store.ensureProject({ checkoutRoot: root, repositoryIdentity: root });
  const binding = sourceBindingFromLocation({ checkoutRoot: root, repositoryIdentity: root });
  const { sources, ...metadata } = original;
  const projectFile = path.join(store.storeRoot, 'project.json');
  const setFile = path.join(store.storeRoot, 'diagram-sets', 'set-old', 'diagram-set.json');
  await mkdir(path.dirname(setFile), { recursive: true });
  const legacy = JSON.stringify({ schemaVersion: 1, source: binding, diagramIds: ['old-artifact'] });
  await writeFile(setFile, legacy);
  await writeFile(projectFile, JSON.stringify({ ...metadata, diagramSetIds: ['set-old'] }));
  const catalog = await store.projectCatalogs.loadRepresentationCatalog(original.id);
  await store.projectCatalogs.saveRepresentationCatalog(catalog);
  const resolved = await resolveDiagramSource(store, { projectId: original.id });
  expect(resolved.binding()).toEqual(binding);
  expect(await readFile(setFile, 'utf8')).toBe(legacy);
  expect(await store.projectCatalogs.loadRepresentationCatalog(original.id)).toEqual(catalog);
  await rm(setFile);
  expect((await resolveDiagramSource(new DiagramStore(root), { projectId: original.id })).binding()).toEqual(binding);
});

it('does not guess a source from project identity when no bindings exist', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mapping-unbound-project-')); roots.push(root);
  const store = new DiagramStore(root);
  const project = await store.ensureProject({ checkoutRoot: root, repositoryIdentity: root });
  await expect(resolveDiagramSource(store, { projectId: project.id })).rejects.toThrow('sourceId');
});
