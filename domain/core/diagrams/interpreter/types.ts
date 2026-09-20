/** Public coordinates are one-based; offsets and range ends are UTF-16, end-exclusive. */
export interface SourceSpan {
  line: number;
  column: number;
  endColumn: number;
  start: number;
  end: number;
}

export type Dialect = 'tree' | 'graph' | 'mixed' | 'unknown';
export interface ParseOptions {
  dialect?: Dialect;
  tabSize?: number;
  treeTolerance?: number;
  wireTolerance?: number;
  continuation?: 'auto' | 'join' | 'separate';
  detachedLists?: 'auto' | 'include';
  repairs?: 'conservative' | 'none';
  /** Preserve the app's historical arrow-tree headings and narrow branch grammar. */
  compatibility?: 'ascii-tree-1' | 'ascii-tree-2';
  maxChars?: number;
  maxColumns?: number;
  maxCandidates?: number;
  maxNodes?: number;
  maxMatchingCells?: number;
  recognizers?: readonly Recognizer[];
  glyphs?: Readonly<Record<string, GlyphKind>>;
}
export type Policy = Required<Omit<ParseOptions, 'recognizers' | 'glyphs' | 'compatibility'>> &
  Pick<ParseOptions, 'compatibility'>;
export type GlyphKind = 'horizontal' | 'vertical' | 'joint' | 'left' | 'right' | 'up' | 'down';

export interface SourceRow {
  readonly line: number;
  readonly text: string;
  readonly raw: string;
  readonly start: number;
  readonly block: number;
  readonly kind: 'content' | 'blank' | 'metadata' | 'outside';
  /** One original offset pair for every normalized UTF-16 column. */
  readonly offsets: readonly (readonly [number, number])[];
}
export interface SourceDocument {
  readonly original: string;
  readonly rows: readonly SourceRow[];
}
export interface Candidate {
  id: string;
  ruleId: string;
  kind: 'branch' | 'route' | 'vertical';
  span: SourceSpan;
  /** Branches may be bullets or carry a head; interpretation chooses their role. */
  bullet?: boolean;
  headed?: boolean;
}
export interface RecognitionContext {
  readonly source: SourceDocument;
  readonly row: SourceRow;
  readonly column: number;
  readonly glyphs: Readonly<Record<string, GlyphKind>>;
  readonly policy: Readonly<Policy>;
}
export interface Recognition {
  kind: Candidate['kind'];
  /** End-exclusive normalized column (one-based). */
  endColumn: number;
  bullet?: boolean;
  headed?: boolean;
}
export interface Recognizer {
  readonly id: string;
  /** Dispatch categories or literal characters. All applicable rules run. */
  readonly starts: readonly string[];
  recognize(context: RecognitionContext): readonly Recognition[];
}

export interface Decision {
  id: string;
  ruleId: string;
  reason: string;
  evidence: SourceSpan[];
  candidateIds: string[];
  repairIds: string[];
}
export interface Unresolved {
  id: string;
  code: string;
  reason: string;
  spans: SourceSpan[];
  alternatives: { description: string; candidateIds?: string[]; nodeIds?: string[] }[];
}
export interface Diagnostic {
  code: string;
  line: number;
  severity: 'info' | 'warning' | 'error';
  message: string;
}
export interface DiagramNode {
  id: string;
  kind: 'tree-item' | 'text';
  label: string;
  regionId: string;
  spans: SourceSpan[];
  branchColumn?: number;
  parentId?: string;
  childIds: string[];
  decisionIds: string[];
}
export interface DiagramEdge {
  id: string;
  kind: 'contains' | 'references';
  from: string;
  to: string;
  /** A head meeting a branch addresses the region, not that branch's item. */
  targetKind?: 'node' | 'region';
  decisionId: string;
  wireCells?: { line: number; column: number }[];
}
export interface Region {
  id: string;
  kind: 'tree' | 'text';
  nodeIds: string[];
  rootIds: string[];
}
export interface Repair {
  id: string;
  kind: 'tree-alignment' | 'wire-alignment';
  reason: string;
  spans: SourceSpan[];
  /** Describes logical geometry; original source is never rewritten. */
  moves: { line: number; column: number; toColumn: number }[];
  changesStructure: boolean;
}
export interface DiagramInterpretation {
  parserVersion: 'spatial-diagram-1';
  source: SourceDocument;
  policy: Policy;
  glyphs: Readonly<Record<string, GlyphKind>>;
  candidates: Candidate[];
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  regions: Region[];
  decisions: Decision[];
  repairs: Repair[];
  unresolved: Unresolved[];
  diagnostics: Diagnostic[];
  /** Every original line remains addressable, including prose and unknown syntax. */
  lines: { line: number; kind: string; nodeIds: string[] }[];
}

/** Internal layout records keep interpretation geometry separate from source coordinates. */
export interface Label {
  span: SourceSpan;
  text: string;
  branch?: Candidate;
  guides: number[];
  block: number;
  column: number;
  anchor?: number;
  uncertain?: boolean;
  node?: DiagramNode;
}
export interface WireCell {
  line: number;
  column: number;
  glyph: GlyphKind;
  raw: string;
  candidateId: string;
  span: SourceSpan;
}
