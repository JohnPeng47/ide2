import type { BuiltInDomainProfileId, CorpusBinding } from "../../../domain/core/profiles/domainProfile";

export interface RepositoryLocation {
  checkoutRoot: string;
  repositoryIdentity: string;
  gitRevision?: string;
  domainProfileId?: BuiltInDomainProfileId;
  corpus?: CorpusBinding;
}
