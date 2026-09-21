/** Clipboard layout for Mapping rectangle selections. */
export function formatAsciiWithCodeReferences(
  asciiSelections: readonly string[],
  codeReferences: readonly string[]
): string {
  return [
    asciiSelections.join("\n\n"),
    "Associated Code Entities:",
    ...new Set(codeReferences)
  ].join("\n");
}
