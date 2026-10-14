import { describe, expect, it } from 'vitest';
import { diagramSyntaxLine } from '../diagramSyntax';
import { buildDiagramContent } from '../diagramContent';
import { diagramTextRanges, textRow } from '../diagramText';
import type { DiagramSourceContext } from '../diagram';

const tokens = (text: string) => diagramSyntaxLine(text, 'diagram').map(r => ({ text: text.slice(r.start, r.end), ...r.syntax }));
const token = (text: string, word: string) => tokens(text).find(t => t.text === word);
const ascii = 'interface CanvasSession\n|-- controller: CanvasSession\n`-- applyUpdate(expectedVersion, operations)';
const content = buildDiagramContent(ascii, 'syntax:0', 'tree');
const evidence: DiagramSourceContext = {
  contentHash: content.asciiSha256,
  binding: { sourceId: 'repo', repositoryIdentity: '/repo/.git', domainProfileId: 'source-code', corpus: { kind: 'git-worktree', root: '/repo', revision: 'captured-sha' } },
  mappings: [
    { id: 'def', entityId: 'session', sourceRangeIndex: 0, line: 1, startColumn: 11, endColumn: 23 },
    { id: 'ref', entityId: 'session', sourceRangeIndex: 0, line: 2, startColumn: 17, endColumn: 29 }
  ],
  evidence: { session: { id: 'session', handle: 'CanvasSession', label: 'CanvasSession', category: 'interface-data-struct', summary: '',
    sourceRanges: [{ id: 'range', path: 'session.ts', symbol: 'CanvasSession', startLine: 4, endLine: 4, originalLines: ['export interface CanvasSession {}'] }] } }
};
const rows = (sourceContext = evidence) => {
  const ranges = diagramTextRanges({ ascii, content, displayNodeId: 'grid:example', sourceContext, mappings: sourceContext.mappings });
  return ascii.split('\n').map((text, i) => textRow(text, ranges.get(i + 1)!, i + 1));
};

describe('diagram syntax', () => {
  it('separates member definitions, type references, method signatures and calls', () => {
    expect(token('|-- workspace: CanvasWorkspace', 'workspace')).toMatchObject({ kind: 'variable', role: 'definition' });
    expect(token('|-- workspace: CanvasWorkspace', 'CanvasWorkspace')).toMatchObject({ kind: 'type', role: 'reference' });
    expect(token('getSnapshot(): ControllerSnapshot', 'getSnapshot')).toMatchObject({ kind: 'function', role: 'definition' });
    expect(token('controller.applyUpdate(expectedVersion, operations)', 'applyUpdate')).toMatchObject({ kind: 'function', role: 'reference' });
    expect(token('controller.applyUpdate(expectedVersion, operations)', 'operations')).toMatchObject({ kind: 'variable', role: 'reference' });
    expect(token('export class CanvasSession', 'CanvasSession')).toMatchObject({ kind: 'type', role: 'definition' });
    expect(token('static fromSnapshot(snapshot): AgentContext', 'static')).toMatchObject({ kind: 'keyword' });
    expect(token('new Editor({ store, tools })', 'Editor')).toMatchObject({ kind: 'type', role: 'reference' });
  });

  it('protects prose, file paths, URLs and bracketed explanations', () => {
    for (const text of ['History: owned by SessionManager', 'Return fresh history objects', 'new canvas has none']) {
      expect(tokens(text).filter(t => t.kind === 'keyword' || t.role === 'definition')).toEqual([]);
    }
    expect(tokens('[single source of truth]')).toEqual([]);
    expect(tokens('Source: domain/core/CanvasHistory.ts')).toEqual([]);
    expect(tokens('GET /api/mapping/agent/tools/{toolName}')).toEqual([]);
    expect(tokens('https://example.com/CanvasHistory')).toEqual([]);
    expect(token('Version: 03f2168', '03')).toBeUndefined();
  });

  it('distinguishes bracket tags from tuples and array access without inventing links', () => {
    expect(token('[D3] AgentContext', '[D3]')).toMatchObject({ kind: 'reference', role: 'definition' });
    expect(token('AgentContext [D3]', '[D3]')).toMatchObject({ kind: 'reference', role: 'reference' });
    expect(tokens('[sessionId, requestId]').some(t => t.kind === 'reference')).toBe(false);
    expect(tokens('drafts[documentId]').some(t => t.kind === 'reference')).toBe(false);
    expect(token('TLEditorSnapshot [T7b]', '[T7b]')).toMatchObject({ kind: 'reference' });
  });

  it('recognizes strings and numbers without coloring the inside of a string', () => {
    expect(tokens('kind: "grid"')).toContainEqual(expect.objectContaining({ text: '"grid"', kind: 'string' }));
    expect(tokens('"CanvasSession.applyUpdate()"')).toHaveLength(1);
    expect(token('schemaVersion: 3', '3')).toMatchObject({ kind: 'number' });
    expect(token('150 ms debounce', '150')).toMatchObject({ kind: 'number' });
    expect(token('value: null', 'null')).toMatchObject({ kind: 'keyword' });
  });

  it('uses captured evidence for identity, keeping references distinct from declarations', () => {
    const rendered = rows();
    expect(rendered.map(row => row.runs.map(run => run.text).join('')).join('\n')).toBe(ascii);
    const defs = rendered[0].runs.filter(r => r.syntax?.role === 'definition');
    const ref = rendered[1].runs.find(r => r.text === 'CanvasSession')!;
    expect(defs).toHaveLength(1);
    expect(ref.syntax?.role).toBe('reference');
    expect(ref.syntax?.symbol).toBe(defs[0].syntax?.symbol);
    expect(ref.syntax?.title).toContain('session.ts:4');
    expect(ref.syntax?.title).toContain('captured-sha');
    expect(ref.mappings.map(m => m.id)).toEqual(['ref']);
    expect(ref.owner?.sourceLine).toBe(2);
  });

  it('drops semantic claims for stale, missing and ambiguous evidence', () => {
    expect(rows({ ...evidence, contentHash: 'stale' }).flatMap(r => r.runs).some(r => r.syntax?.title)).toBe(false);
    expect(rows({ ...evidence, evidence: {} }).flatMap(r => r.runs).some(r => r.syntax?.title)).toBe(false);
    const ambiguous: DiagramSourceContext = { ...evidence,
      mappings: [...evidence.mappings, { ...evidence.mappings[1], id: 'other', entityId: 'other' }],
      evidence: { ...evidence.evidence, other: { ...evidence.evidence.session, id: 'other', sourceRanges: [{ ...evidence.evidence.session.sourceRanges[0], path: 'other.ts' }] } } };
    const ref = rows(ambiguous)[1].runs.find(r => r.text === 'CanvasSession')!;
    expect(ref.syntax).toBeUndefined();
    expect(ref.mappings).toHaveLength(2);
  });
});
