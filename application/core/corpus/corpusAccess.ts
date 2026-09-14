import type { BuiltInDomainProfileId, CorpusBinding, CorpusProvider } from "../../../domain/core/profiles/domainProfile";
import type { RepositoryLocation } from "./location";

export interface ReadableCorpusProvider extends CorpusProvider {
  readDocumentBytes(binding: CorpusBinding, path: string): Promise<Buffer>;
  readDocumentText(binding: CorpusBinding, path: string): Promise<string>;
  readDocumentLines(binding: CorpusBinding, path: string): Promise<string[]>;
}

export interface CorpusAccess {
  provider(binding: CorpusBinding): ReadableCorpusProvider;
  readDocumentLines(binding: CorpusBinding, path: string): Promise<string[]>;
  discover(inputPath: string, profile: BuiltInDomainProfileId): Promise<RepositoryLocation>;
}
