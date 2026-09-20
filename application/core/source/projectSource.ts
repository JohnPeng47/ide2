import { resolveDiagramSource, type DiagramSourceReference } from './diagramSource';
import { createHash } from 'node:crypto';
import type { SourcePosition } from '../../../domain/core/source/sourceNavigation';
import type { CorpusAccess } from '../corpus/corpusAccess';
import { ApplicationError } from '../errors';
import type { DiagramRepository } from '../ports/diagramRepository';
import type { LanguageService } from './languageService';

export class ProjectSourceService {
  constructor(
    private readonly projects: Pick<DiagramRepository, 'loadProject' | 'projectCatalogs' | 'loadDiagramSet'>,
    private readonly corpus: CorpusAccess,
    private readonly language?: LanguageService
  ) { }

  async files(projectId: string | null, directory: string, sourceId?: string) {
    const source = await resolveDiagramSource(this.projects, {projectId: projectId ?? '', sourceId}, this.corpus);
    return source.listFiles(directory);
  }

  ensureDefinitionsEnabled(): void {
    if (!this.language) throw new ApplicationError('lsp-disabled', 'Definition lookup is disabled. Start the server with --lsp to enable it.');
  }

  async definitions(input: DiagramSourceReference & { path: string; position: SourcePosition; sourceSha256: string }, signal: AbortSignal) {
    if (!this.language) throw new ApplicationError('lsp-disabled', 'Definition lookup is disabled. Start the server with --lsp to enable it.');
    const source = await resolveDiagramSource(this.projects, input, this.corpus);
    return this.language.definitions(source.binding().corpus, input.path, input.position, input.sourceSha256, signal);
  }

  async source(projectId: string | null, sourcePath: string | null, sourceId?: string) {
    if (!sourcePath) throw new ApplicationError('invalid-input', 'Source path is required');
    const resolved = await resolveDiagramSource(this.projects, {projectId: projectId ?? '', sourceId}, this.corpus);
    const source = await resolved.readText(sourcePath);
    if (source.includes('\0')) throw new ApplicationError('binary-source', 'This is a binary file. The source pane displays text files.');
    return {
      path: sourcePath, startLine: 1, lines: source.split(/\r?\n/),
      sourceSha256: createHash('sha256').update(source).digest('hex'), lspEnabled: Boolean(this.language)
    };
  }
}
