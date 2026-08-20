export interface CodeEntityPromptInput {
  diagramSetName: string;
  initialPrompt: string;
}

/** Prompt for turning repository source into source-backed CodeEntity objects. */
export function codeEntityCollectionPrompt(input: CodeEntityPromptInput): string {
  return `Collect code entities for the diagram set "${input.diagramSetName}".

Request:
${input.initialPrompt || "Map the requested code feature."}

By code-entities, I mean labels in a diagram that map to ranges of source code.
Classify each as State, Interface / Data Struct, or Operation. These categories
are intentionally broad; use your best judgement. Return concise summaries and
exact repo-relative source ranges.

For every source range, also create a compactedSource presentation:
- Choose level "low", "medium", or "high". Low retains most implementation
  detail, medium preserves structure and important operations, and high keeps
  mainly declarations, boundaries, and critical calls.
- Represent retained spans as source sections and omitted spans as
  collapsed-comment sections with exact original line ranges.
- Prefer a few cohesive spans over scattered individual statements. Preserve
  function, class, method, and type declarations, and keep short functions whole
  when they clarify the entity.
- Prioritize calls, data boundaries, and interfaces that explain how the entity
  participates in the requested diagram.
- Write each collapsed comment as a concise architectural explanation of that
  omitted range. Return plain comment text without //, /* */, or separator art;
  the UI supplies the inline-comment notation.
- Do not copy source text into the sections. The server snapshots the exact
  originalLines for the complete range after resolving your line coordinates.

Finish by calling submit_code_entities exactly once.`;
}
