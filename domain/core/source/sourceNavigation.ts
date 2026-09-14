/** Zero-based UTF-16 positions, matching the language service wire format. */
export interface SourcePosition { line: number; character: number }
export interface SourceLocation { path: string; range?: { start: SourcePosition; end: SourcePosition } }
export interface SourceDefinitions { locations: SourceLocation[]; outsideRoot: number }
export function isRepositoryFilePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !/[\\\0:]/.test(value)
    && !value.split('/').some(part => !part || part === '.' || part === '..');
}
export function supportsDefinitions(path: string) { return /\.(?:[cm]?[jt]s|[jt]sx)$/i.test(path); }
