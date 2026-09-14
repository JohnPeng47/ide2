import { createHash } from 'node:crypto';
import type { SourcePosition } from '../../../domain/core/source/sourceNavigation';
import type { CorpusAccess } from '../corpus/corpusAccess';
import { ApplicationError } from '../errors';
import type { DiagramRepository } from '../ports/diagramRepository';
import type { LanguageService } from './languageService';

export class ProjectSourceService {
  constructor(
    private readonly projects: Pick<DiagramRepository, 'loadProject'>,
    private readonly corpus: CorpusAccess,
    private readonly language?: LanguageService
  ) { }

  async files(projectId: string | null, directory: string) {
    const project = await this.projects.loadProject();
    if (!project || projectId !== project.id) throw new ApplicationError('conflict', 'Repository belongs to another project');
    return this.corpus.provider(project.corpus).listDirectory(project.corpus, directory);
  }

  ensureDefinitionsEnabled(): void {
    if (!this.language) throw new ApplicationError('lsp-disabled', 'Definition lookup is disabled. Start the server with --lsp to enable it.');
  }

  async definitions(input: { projectId: string; path: string; position: SourcePosition; sourceSha256: string }, signal: AbortSignal) {
    if (!this.language) throw new ApplicationError('lsp-disabled', 'Definition lookup is disabled. Start the server with --lsp to enable it.');
    const project = await this.projects.loadProject();
    if (!project || input.projectId !== project.id) throw new ApplicationError('conflict', 'Source belongs to another project');
    return this.language.definitions(project.corpus, input.path, input.position, input.sourceSha256, signal);
  }

  async source(projectId: string | null, sourcePath: string | null) {
    const project = await this.projects.loadProject();
    if (!project || projectId !== project.id) throw new ApplicationError('conflict', 'Source belongs to another project; reopen the diagram.');
    if (!sourcePath) throw new ApplicationError('invalid-input', 'Source path is required');
    const source = await this.corpus.provider(project.corpus).readDocumentText(project.corpus, sourcePath);
    if (source.includes('\0')) throw new ApplicationError('binary-source', 'This is a binary file. The source pane displays text files.');
    return {
      path: sourcePath, startLine: 1, lines: source.split(/\r?\n/),
      sourceSha256: createHash('sha256').update(source).digest('hex'), lspEnabled: Boolean(this.language)
    };
  }
}
