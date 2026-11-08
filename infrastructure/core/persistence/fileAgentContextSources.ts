import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import type { AgentContextSources } from '../../../application/core/ports/agentContextSources';
import { AgentContext, agentContextSourceRanges, AGENT_CONTEXT_MAX_BYTES, type AgentContextSnapshot } from '../../../domain/core/agents/agentContext';
import { sourceRangeSchema, sourceFileSchema, sourceFileHash, sourceRangeText, captureSourceRangeSchema,
  type AgentContextSourceFile, type AgentContextSourceRange, type CaptureSourceRange } from '../../../domain/core/agents/agentContextSource';
import type { CorpusBinding } from '../../../domain/core/profiles/domainProfile';
import { corpusProvider } from '../corpus/corpus';
import { ImmutableRecords } from './immutableRecords';

const exec = promisify(execFile);
/** Shared across saved contexts and diagram contexts. No caller-supplied absolute file paths. */
export class FileAgentContextSources implements AgentContextSources {
  private readonly blobs: ImmutableRecords;
  private readonly pinned = new Map<string, Promise<AgentContextSourceFile>>();
  constructor(root: string, private readonly binding?: (sourceId: string) => Promise<CorpusBinding>) {
    this.blobs = new ImmutableRecords(path.join(root, 'agent-context-sources'));
  }
  private async source(id: string) {
    if (!this.binding) throw Error('AGENT_CONTEXT_SOURCE_UNAVAILABLE: source registry is unavailable');
    return this.binding(id);
  }
  private async git(binding: CorpusBinding, args: string[]) {
    if (binding.kind !== 'git-worktree') throw Error('AGENT_CONTEXT_SOURCE_UNAVAILABLE: source is not Git');
    return (await exec('git', ['--no-replace-objects', '-C', binding.root, ...args], { encoding: 'utf8', maxBuffer: AGENT_CONTEXT_MAX_BYTES })).stdout;
  }
  private file(text: string): AgentContextSourceFile {
    if (Buffer.byteLength(text) > AGENT_CONTEXT_MAX_BYTES) throw Error('AGENT_CONTEXT_TOO_LARGE: source exceeds 2 MiB');
    if (text.includes('\0')) throw Error('AGENT_CONTEXT_SOURCE_INVALID: binary source');
    return { startLine: 1, lines: text.split(/\r?\n/) };
  }
  private pinnedFile(binding: CorpusBinding, commit: string, file: string) {
    const key = JSON.stringify([binding.root, commit, file]);
    let pending = this.pinned.get(key);
    if (!pending) {
      pending = this.readPinnedFile(binding, commit, file);
      // Each file is at most 2 MiB. Repeated ranges share one read; failures are retryable.
      this.pinned.set(key, pending);
      while (this.pinned.size > 16) this.pinned.delete(this.pinned.keys().next().value!);
      void pending.catch(() => { if (this.pinned.get(key) === pending) this.pinned.delete(key); });
    }
    return pending;
  }
  private async readPinnedFile(binding: CorpusBinding, commit: string, file: string) {
    // Reject trees, submodules and symlinks instead of treating their payload as source text.
    const entry = await this.git(binding, ['ls-tree', commit, '--', file]);
    if (!/^100(?:644|755) blob /.test(entry) || entry.trimEnd().split('\n').length !== 1)
      throw Error('AGENT_CONTEXT_SOURCE_UNAVAILABLE: expected a regular Git file');
    return this.file(await this.git(binding, ['show', `${commit}:${file}`]));
  }
  async capture(raw: CaptureSourceRange) {
    const input = captureSourceRangeSchema.parse(raw), binding = await this.source(input.sourceId);
    let file: AgentContextSourceFile, version: AgentContextSourceRange['version'];
    const revision = input.revision ?? (binding.kind === 'git-worktree' ? binding.revision : undefined);
    if (revision) {
      const commit = (await this.git(binding, ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`])).trim();
      file = await this.pinnedFile(binding, commit, input.path); version = { kind: 'git', commit };
    } else {
      file = this.file(await corpusProvider(binding).readDocumentText(binding, input.path));
      version = { kind: 'snapshot', contentHash: sourceFileHash(file) };
      if (binding.kind === 'git-worktree') {
        // Reuse committed bytes only when they exactly match the captured worktree content.
        try {
          const commit = (await this.git(binding, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
          const committed = await this.pinnedFile(binding, commit, input.path);
          if (sourceFileHash(committed) === sourceFileHash(file)) version = { kind: 'git', commit };
        } catch { /* Untracked files and unborn repositories use a shared immutable snapshot. */ }
      }
    }
    const reference = sourceRangeSchema.parse({ type: 'sourceRange', sourceId: input.sourceId, path: input.path,
      startLine: input.startLine, endLine: input.endLine ?? file.startLine + file.lines.length - 1, version });
    sourceRangeText(reference, file);
    if (version.kind === 'snapshot') await this.blobs.put(file);
    return reference;
  }
  private async load(reference: AgentContextSourceRange) {
    sourceRangeSchema.parse(reference);
    const file = reference.version.kind === 'snapshot'
      ? sourceFileSchema.parse(await this.blobs.get(reference.version.contentHash))
      : await this.pinnedFile(await this.source(reference.sourceId), reference.version.commit, reference.path);
    sourceRangeText(reference, file);
    return file;
  }
  async read(reference: AgentContextSourceRange) { return sourceRangeText(reference, await this.load(reference)); }
  async persist(raw: AgentContextSnapshot) {
    const context = AgentContext.fromSnapshot(raw), snapshot = context.toSnapshot();
    for (const file of Object.values(snapshot.sourceFiles ?? {})) await this.blobs.put(file);
    // Check references before publication, including imported descriptors with missing blobs.
    const seen = new Set<string>();
    for (const block of agentContextSourceRanges(snapshot.messages)) {
      const key = JSON.stringify(block);
      if (!seen.has(key)) { await this.load(block); seen.add(key); }
    }
    return context.withoutSourceFiles();
  }
  async portable(raw: AgentContextSnapshot) {
    const context = AgentContext.fromSnapshot(raw), snapshot = context.toSnapshot();
    const files: Record<string, AgentContextSourceFile> = {};
    const references = new Map<string, AgentContextSourceRange>();
    for (const block of agentContextSourceRanges(snapshot.messages)) {
      const key = JSON.stringify(block);
      if (references.has(key)) continue;
      const file = block.version.kind === 'snapshot' && snapshot.sourceFiles?.[block.version.contentHash]
        || await this.load(block);
      // Portable context contains only its selected evidence, not unrelated file lines.
      const selected = { startLine: block.startLine,
        lines: file.lines.slice(block.startLine - file.startLine, block.endLine - file.startLine + 1) };
      const contentHash = sourceFileHash(selected); files[contentHash] = selected;
      references.set(key, { ...block, version: { kind: 'snapshot', contentHash } });
    }
    const replace = (block: { type: string }) => block.type === 'sourceRange' ? references.get(JSON.stringify(block))! : block;
    const messages = snapshot.messages.map(message => ({ ...message, content: message.content.map(block => block.type === 'section'
      ? { ...block, content: block.content.map(replace) } : replace(block)) }));
    return context.withMessages(messages, files).toSnapshot();
  }
}
