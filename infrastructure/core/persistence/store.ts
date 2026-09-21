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
  readonly checkoutRoot: string;
  readonly storeRoot: string;
  readonly projectCatalogs: ProjectCatalogStore;
  private readonly context: PersistenceContext;
  constructor(checkoutRoot: string, diagramsDirectory = ".diagrams") {
    this.checkoutRoot = path.resolve(checkoutRoot);
    this.storeRoot = path.resolve(this.checkoutRoot, diagramsDirectory);
    this.projectCatalogs = new ProjectCatalogStore(this.storeRoot);
    this.context = { checkoutRoot: this.checkoutRoot, storeRoot: this.storeRoot, projectCatalogs: this.projectCatalogs };
  }
  async ensureProject(location: RepositoryLocation): Promise<ProjectRecord> { return projectsStore.ensureProject(this.context, location); }

  async loadProject(): Promise<ProjectRecord | null> { return projectsStore.loadProject(this.context); }
}
