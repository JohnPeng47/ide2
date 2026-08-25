import { CodeEntity, Diagram, DiagramComponent } from "../domain";
import type { ResolvedReference } from "../referenceResolver";

export type RefTextFormat = "prompt-token" | "source-location" | "prompt-context";

export class UnsupportedReferenceFormatError extends Error {
  constructor(readonly format: RefTextFormat, readonly kinds: string[]) {
    super(`${format} does not support reference kind(s): ${kinds.join(", ")}`);
  }
}

function promptToken(ref: ResolvedReference): string {
  if (ref.kind === "code-entity") return `@entity/${ref.record.handle}`;
  if (ref.kind === "diagram") return `@diagram/${ref.record.handle}`;
  return `@component/${ref.record.handle}`;
}

function promptContext(ref: ResolvedReference): string {
  if (ref.kind === "code-entity") return new CodeEntity(ref.record).prompt_str();
  if (ref.kind === "diagram") return new Diagram(ref.record).prompt_str();
  return new DiagramComponent(ref.record).prompt_str();
}

function uniqueText(values: string[]): string[] {
  return [...new Set(values)];
}

export function formatReferences(refs: ResolvedReference[], format: RefTextFormat): string {
  if (format === "prompt-token") {
    return uniqueText(refs.map(promptToken)).join(" ");
  }
  if (format === "prompt-context") {
    return uniqueText(refs.map(promptContext)).join("\n\n");
  }
  const unsupported = uniqueText(refs.filter((ref) => ref.kind !== "code-entity").map((ref) => ref.kind));
  if (unsupported.length > 0) throw new UnsupportedReferenceFormatError(format, unsupported);
  const locations = refs.flatMap((ref) => {
    if (ref.kind !== "code-entity") return [];
    const ranges = ref.sourceRange ? [ref.sourceRange] : ref.record.sourceRanges;
    return ranges.map((range) => `${range.path}:${range.startLine}-${range.endLine}`);
  });
  return uniqueText(locations).join(" ");
}

export function displayTextForReference(ref: ResolvedReference): string {
  const selectionText = ref.selectableText?.getSelectionText(ref.identity);
  return selectionText ?? promptToken(ref);
}
