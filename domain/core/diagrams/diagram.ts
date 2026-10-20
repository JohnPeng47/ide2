import { validateDiagramHighlights, type DiagramHighlight } from './diagramHighlight';
import type { DeepReadonly } from '../immutability';
import { validateDiagramJumps, type DiagramJump } from './diagramJump';
import { buildDiagramContent, type DiagramContent } from './diagramContent';
import { validateDiagramLocalMappings } from './diagramMappings';
import { mappingsForSelection } from './diagramSelection';
import { asciiSha256 } from './asciiSha256';
import type { DiagramElementMapping } from '../records/domain';
import type { CorpusBinding, BuiltInDomainProfileId } from '../profiles/domainProfile';
import type { ProjectRepresentationEvidenceRecord } from '../representations/projectCatalog';

export interface DiagramSourceBinding {
  sourceId: string;
  repositoryIdentity: string;
  corpus: CorpusBinding;
  domainProfileId: BuiltInDomainProfileId;
}
export type DiagramSourceContext = DeepReadonly<{
  binding?: DiagramSourceBinding;
  contentHash: string;
  mappings: readonly DiagramElementMapping[];
  evidence: Record<string, ProjectRepresentationEvidenceRecord>;
}>;
/** Repository-independent diagram, shared by canvas, persistence, and agents. */
export interface Diagram {
  /** Stable service identity; id remains the local canvas content key. */
  readonly diagramId: string;
  readonly revisionId: string;
  readonly id: string;
  readonly revision: number;
  readonly content: DeepReadonly<DiagramContent>;
  readonly sourceContext: DeepReadonly<DiagramSourceContext>;
  readonly highlights?: DeepReadonly<DiagramHighlight[]>;
  readonly jumps?: DeepReadonly<DiagramJump[]>;
}
export interface DiagramInput {
  id: string; revision: number; ascii: string; structureKind?: 'diagram' | 'tree';
  mappings?: readonly DiagramElementMapping[];
  evidence?: DiagramSourceContext['evidence'];
  source?: DiagramSourceBinding;
  highlights?: readonly DiagramHighlight[];
  jumps?: readonly DiagramJump[];
}
export function validateSourceBinding(binding: DiagramSourceBinding): void {
  if (!binding || typeof binding.sourceId !== 'string' || !binding.sourceId || binding.sourceId.length > 200
    || typeof binding.repositoryIdentity !== 'string' || !binding.repositoryIdentity
    || !['source-code','document'].includes(binding.domainProfileId) || !binding.corpus
    || !['git-worktree','filesystem-documents'].includes(binding.corpus.kind)
    || typeof binding.corpus.root !== 'string' || !/^(?:\/|[A-Za-z]:[\\/])/.test(binding.corpus.root)
    || (binding.domainProfileId === 'source-code') !== (binding.corpus.kind === 'git-worktree')) throw new Error('Invalid diagram source binding');
}
export function validateDiagram(diagram: Diagram): void {
  if (diagram?.content && (!diagram.diagramId || !diagram.revisionId))
    throw new Error('Diagram storage migration required: saved diagrams lack service identities. Run the offline diagram identity migration before loading this store.');
  if (!diagram || typeof diagram.diagramId !== 'string' || !diagram.diagramId.startsWith('diagram-') || typeof diagram.revisionId !== 'string' || !diagram.revisionId.startsWith('diagram-revision-') || typeof diagram.id !== 'string' || !diagram.id || !Number.isInteger(diagram.revision) || diagram.revision < 0 || !diagram.content) throw new Error('Invalid diagram');
  if (['ascii','mappings','diagramContent','structureKind'].some(key => Object.hasOwn(diagram,key))) throw new Error('Diagram data must live in content and sourceContext');
  const { content, sourceContext: source } = diagram;
  const canonical = buildDiagramContent(content.ascii, `${diagram.id}:${diagram.revision}`, content.structure.kind, content.structure.kind === 'tree' ? content.structure.parserVersion : undefined);
  if (JSON.stringify(content) !== JSON.stringify(canonical)) throw new Error('Invalid diagram content revision or parsed structure');
  if (!source || !source.evidence || !Array.isArray(source.mappings) || source.contentHash !== asciiSha256(content.ascii)) throw new Error('Diagram source context does not match content');
  if (source.binding) validateSourceBinding(source.binding);
  validateDiagramJumps(content, diagram.jumps);
  validateDiagramHighlights(diagram.highlights);
  validateDiagramLocalMappings(content.ascii, source.mappings);
  for (const [id, entry] of Object.entries(source.evidence)) {
    if (entry?.sourceId && source.binding && entry.sourceId !== source.binding.sourceId) throw new Error('Evidence belongs to another diagram source');
    if (!entry || entry.id !== id || typeof entry.label !== 'string' || !Array.isArray(entry.sourceRanges)) throw new Error('Invalid diagram evidence');
    for (const range of entry.sourceRanges) {
      if (!range || typeof range.id !== 'string' || typeof range.path !== 'string' || range.path.startsWith('/') || range.path.split(/[\\/]/).includes('..')
        || !Number.isInteger(range.startLine) || range.startLine < 1 || !Number.isInteger(range.endLine) || range.endLine < range.startLine
        || !Array.isArray(range.originalLines) || range.originalLines.length !== range.endLine - range.startLine + 1 || range.originalLines.some((line: unknown) => typeof line !== 'string')) throw new Error('Invalid diagram evidence range');
    }
  }
  for (const mapping of source.mappings) {
    const range = source.evidence[mapping.entityId]?.sourceRanges[mapping.sourceRangeIndex];
    if (!range || mapping.sourceRangeId && mapping.sourceRangeId !== range.id) throw new Error('Mapping references unknown diagram evidence');
  }
}
/** All mapping/evidence joins live here; callers receive derived, read-only results. */
export function diagramSource(diagram: Diagram) {
  return queryDiagramSourceContext(diagram.sourceContext);
}
export function queryDiagramSourceContext(context: DiagramSourceContext) {
  const evidenceFor = (mapping: DiagramElementMapping) => {
    const entity = context.evidence[mapping.entityId];
    const range = entity?.sourceRanges[mapping.sourceRangeIndex];
    return { mapping, entity, range, binding: context.binding };
  };
  return {
    context,
    mappings: () => context.mappings,
    forSelection: (rect: Parameters<typeof mappingsForSelection>[1]) => mappingsForSelection(context.mappings, rect).map(evidenceFor),
    entries: () => context.mappings.map(evidenceFor),
    search: (query: string) => {
      const q = query.toLowerCase();
      return context.mappings.map(evidenceFor).filter(({mapping,entity,range}) => [mapping.entityId,entity?.label,range?.path,range?.symbol].some(value=>value?.toLowerCase().includes(q)));
    }
  };
}
export function sourceBindingFromLocation(location: { checkoutRoot: string; repositoryIdentity: string; domainProfileId?: BuiltInDomainProfileId; corpus?: CorpusBinding; gitRevision?: string }): DiagramSourceBinding {
  const corpus = location.corpus ?? { kind: 'git-worktree' as const, root: location.checkoutRoot, ...(location.gitRevision ? {revision:location.gitRevision} : {}) };
  return { sourceId: `source-${asciiSha256(`${corpus.kind}:${corpus.root}`).slice(0,24)}`, repositoryIdentity: location.repositoryIdentity,
    corpus, domainProfileId: location.domainProfileId ?? 'source-code' };
}
