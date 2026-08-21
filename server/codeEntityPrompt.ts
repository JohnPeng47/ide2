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
- Write every collapsed comment as a compact ASCII call graph of that exact
  omitted range. Name the enclosing operation or source concept as the root,
  then show its important calls, loops, conditions, success/error branches, and
  returned result where they actually occur. For ranges without function calls,
  use the same tree shape to show the meaningful data or control flow.
- Use only 7-bit ASCII graph characters such as |, +, -, >, and \\. Keep labels
  source-backed and concise; do not invent calls or behavior merely to make the
  graph look complete.
- Put only the graph body in comment. Do not include line-range headings,
  Markdown fences, //, /* */, or decorative separator art; the UI adds the
  comment prefixes and a "[Lines x-y | n lines compacted]" heading.
- Subdivide the graph into semantic nodes. For every graph line that names an
  operation, call, branch outcome, data transformation, or returned result, add
  one nodes entry whose graphLine is that one-based comment-body line and whose
  startLine/endLine is the exact block of omitted source represented by the
  node. Do not map blank or connector-only lines. Node source blocks must stay
  inside their collapsed-comment section; they may overlap when a parent node
  summarizes the whole section. The UI lets readers expand each mapped node
  independently.
- Follow this general shape, adapting it to the source rather than copying it:
    operation(...)
      |
      +--> dependency()
      +--[condition]--> branch()
      \\--> result
- Do not copy source text into the sections. The server snapshots the exact
  originalLines for the complete range after resolving your line coordinates.

Finish by calling submit_code_entities exactly once.`;
}
