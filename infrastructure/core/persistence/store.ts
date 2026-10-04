import { GitRepositoryRegistry } from './repositoryRegistry';
import { DiagramPersistence } from '../../../domain/core/diagrams/diagramPersistence';
import { DiagramRevisionStore } from './diagramRevisionStore';
import path from "node:path";
import type { RepositoryLocation } from "../../../application/core/corpus/location";
import {
  type ProjectRecord
} from "../../../domain/core/records/domain";
import type { PersistenceContext } from './context';
import { ProjectCatalogStore } from "./projectCatalogStore";
import * as projectsStore from './projects';
export type { RepositoryLocation } from '../../../application/core/corpus/location';
export { discoverDocumentCorpus, discoverDomainCorpus, discoverRepository, projectIdFor } from './shared';

/** Filesystem repository facade; storage operations are grouped by capability. */
export class DiagramStore {
  readonly repositories: GitRepositoryRegistry;
  readonly checkoutRoot: string;
  readonly storeRoot: string;
  readonly projectCatalogs: ProjectCatalogStore;
  readonly diagramPersistence: DiagramPersistence;
  readonly canvases: ProjectCatalogStore;
  private readonly context: PersistenceContext;
  constructor(checkoutRoot: string, diagramsDirectory = ".diagrams") {
    this.checkoutRoot = path.resolve(checkoutRoot);
    this.storeRoot = path.resolve(this.checkoutRoot, diagramsDirectory);
    this.repositories = new GitRepositoryRegistry(this.storeRoot, this.checkoutRoot);
    this.diagramPersistence = new DiagramPersistence(new DiagramRevisionStore(this.storeRoot));
    this.canvases = new ProjectCatalogStore(this.storeRoot, this.diagramPersistence);
    this.projectCatalogs = this.canvases;
    this.context = { checkoutRoot: this.checkoutRoot, storeRoot: this.storeRoot, projectCatalogs: this.projectCatalogs };
  }
  async ensureProject(location: RepositoryLocation): Promise<ProjectRecord> { await projectsStore.ensureProject(this.context, location); return this.repositories.initialize(); }

  async loadProject(): Promise<ProjectRecord | null> { const project = await projectsStore.loadProject(this.context); return project ? this.repositories.initialize() : null; }
}
