const CODE_REFERENCES_HEADING = "Associated Code Entities:";

/** Clipboard layout for Mapping rectangle selections. */
export function formatAsciiWithCodeReferences(
  asciiSelections: readonly string[],
  codeReferences: readonly string[]
): string {
  return [
    asciiSelections.join("\n\n"),
    CODE_REFERENCES_HEADING,
    ...new Set(codeReferences)
  ].join("\n");
}

/** The ASCII of a clipboard selection, without its code entities section. */
export function asciiFromClipboardText(text: string): string {
  const heading = text.lastIndexOf(`\n${CODE_REFERENCES_HEADING}`);
  return heading < 0 ? text : text.slice(0, heading);
}
