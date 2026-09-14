import type { CorpusBinding } from '../../../domain/core/profiles/domainProfile';
import { type SourceDefinitions, type SourcePosition } from '../../../domain/core/source/sourceNavigation';

export interface LanguageService {
  definitions(binding: CorpusBinding, file: string, position: SourcePosition, sourceSha256: string, signal?: AbortSignal): Promise<SourceDefinitions>;
  dispose(): void;
}
