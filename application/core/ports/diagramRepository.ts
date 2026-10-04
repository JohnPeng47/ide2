import { type ProjectRecord } from "../../../domain/core/records/domain";
import type { RepositoryLocation } from '../corpus/location';
import { ProjectCatalogRepository } from "./projectCatalogRepository";

export interface DiagramRepository {
  readonly repositories?: import("./repositoryRegistry").RepositoryRegistry;
  readonly checkoutRoot: string;
  readonly storeRoot: string;
  readonly projectCatalogs: ProjectCatalogRepository;
  ensureProject(location: RepositoryLocation): Promise<ProjectRecord>;
  loadProject(): Promise<ProjectRecord | null>;
}
