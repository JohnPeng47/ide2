// Curated intermediate-resolution tree. Each node's addresses are resolved against
// the checked-in compactions; generation fails on missing/ambiguous labels or stale source.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

const hash = (text) => createHash("sha256").update(text).digest("hex");
const names = { d: "src/domain.ts", b: "src/refBuffer.ts", r: "src/referenceResolver.ts",
  p: "src/prompt.ts", h: "src/derivativePrompt.ts", a: "server/agentRuntime.ts", s: "server/application.ts" };
const files = {};
for (const [key, sourceFile] of Object.entries(names)) {
  const stem = sourceFile.replace("/", "-").replace(/\.ts$/, "");
  const ascii = await readFile(`docs/compactions/${stem}.txt`, "utf8");
  const map = JSON.parse(await readFile(`docs/compactions/${stem}.json`, "utf8"));
  assert.equal(hash(await readFile(sourceFile)), map.sourceSha256, `Stale compaction: ${sourceFile}`);
  files[key] = { sourceFile, sourceSha256: map.sourceSha256, ascii, asciiSha256: hash(ascii), mappings: map.mappings };
}
const text = (line) => line.replace(/^(?:[| ]{4})*(?:\+-- |\\-- |`-- )?/, "");
const depth = (line) => line.search(/\+-- |\\-- |`-- /);
function address(key, query, subtree = false) {
  let lines = files[key].ascii.trimEnd().split("\n");
  // This call tree models the production runtime, not its test double.
  if (key === "a") lines = lines.slice(0, lines.findIndex((line) => text(line).startsWith("export class FakeDiagramAgentRuntime")));
  const exact = lines.flatMap((line, i) => text(line) === query ? [i] : []);
  const matches = exact.length ? exact : lines.flatMap((line, i) => text(line).startsWith(query) ? [i] : []);
  assert.equal(matches.length, 1, `${names[key]}: ambiguous/missing ${query}`);
  const start = matches[0];
  let end = start + 1;
  if (subtree) while (end < lines.length && depth(lines[end]) > depth(lines[start])) end++;
  return Array.from({ length: end - start }, (_, i) => start + i + 1);
}
const ref = (file, query, subtree = false) => ({ file: names[file], treeLines: address(file, query, subtree) });
function within(file, owner, query, subtree = false) {
  const scope = new Set(address(file, owner, true));
  const lines = files[file].ascii.trimEnd().split("\n");
  const ownerDepth = depth(lines[Math.min(...scope) - 1]);
  const matches = [...scope].filter((line) => depth(lines[line - 1]) === ownerDepth + 4 && text(lines[line - 1]).startsWith(query));
  assert.equal(matches.length, 1, `Missing/ambiguous ${owner}.${query}`);
  const start = matches[0];
  const selected = [start];
  if (subtree) for (let line = start + 1; scope.has(line) && depth(lines[line - 1]) > depth(lines[start - 1]); line++) selected.push(line);
  return { file: names[file], treeLines: selected };
}
const n = (label, refs, children = [], evidence = []) => ({ label, refs: Array.isArray(refs) ? refs : [refs], children, evidence });
const q = (file, query) => ref(file, query, true);

const tree = n("Prompt, Reference, Lineage, and Portability", [], [
  n("Mapped diagram selections", ref("d", "export interface DiagramCodeEntityMapRecord"), [
    n("DiagramCodeEntityMapRecord", q("d", "export interface DiagramCodeEntityMapRecord"), [
      n("Artifact identity + ASCII hash pin the spatial mappings", q("d", "export interface DiagramCodeEntityMapRecord"))
    ], ["DiagramCodeEntityMapRecord"]),
    n("DiagramElementMapping", q("d", "export interface DiagramElementMapping"), [
      n("Visible label span + entity + source-range address", q("d", "export interface DiagramElementMapping"))
    ], ["DiagramElementMapping"]),
    n("referenceFromMapping()", q("b", "export referenceFromMapping("), [
      n("Find the entity and prefer a stable source-range ID", ref("b", "range = entity range")),
      n("ReferenceIdentity: target + origin + selected range", q("d", "export interface ReferenceIdentity"))
    ], ["referenceFromMapping", "ReferenceIdentity"])
  ]),
  n("Scoped reference buffer", ref("b", "export reduceRefBuffer("), [
    n("reduceRefBuffer()", q("b", "export reduceRefBuffer("), [
      n("Scope change clears references and captured selections", q("b", "scope")),
      n("Add / remove / replace; retain unique reference identities", q("b", "uniqueReferences("))
    ], ["ReferenceIdentity"]),
    n("resolveReferences()", q("r", "export resolveReferences("), [
      n("resolveReference(): check target and origin", q("r", "export resolveReference("), [
        n("Entity: resolve requested source range", ref("r", "sourceRange = truthy sourceRangeId")),
        n("Diagram / component: retrieve the artifact record", q("r", "identity.kind === \"diagram\"")),
        n("Separate resolved records from unresolved identities", q("r", "export interface ReferenceResolutionResult"))
      ])
    ], ["resolveReference"])
  ]),
  n("Prompt references", ref("p", "createGenerationPromptConfig("), [
    n('"@entity / @diagram / @component"', ref("p", "mentionPattern:"), [
      n("promptOptions(): available entities and artifacts", q("p", "promptOptions("))
    ]),
    n("User's reference choices", ref("d", "export interface GenerationReferenceSelection"), [
      n("GenerationReferenceSelection", q("d", "export interface GenerationReferenceSelection"), [
        n("targetId: intended target", ref("d", "export interface ReferenceIdentity")),
        n("included: include or exclude its content", q("d", "export interface GenerationReferenceSelection"))
      ])
    ]),
    n("createGenerationPromptConfig()", ref("p", "createGenerationPromptConfig("), [
      n("resolveMentions()", q("p", "resolveMentions("), [
        n("Match tokens to targets", ref("p", "options = promptOptions")),
        n("Apply explicit selections and deduplicate", [q("p", "selectionMap("), ref("p", "deduplicate by kind:id")]),
        n("Reject unknown or ambiguous references", [ref("p", "reject ambiguous bare"), ref("p", "option = selectedOption")])
      ]),
      n("renderReferences(): included content", q("p", "renderReferences("), [
        n("Entity: description + source-range context", [q("p", "evidencePromptRepresentation("), q("d", "prompt_str(): string")]),
        n("Diagram: metadata + ASCII", ref("d", "export class Diagram")),
        n("Component: metadata + fragment ASCII", ref("d", "export class DiagramComponent"))
      ], ["GenerationPromptReference"]),
      n("GenerationPromptConfigRecord", [ref("p", "config: GenerationPromptConfigRecord"), ref("p", "selectedCodeEntityIds; rendered references")], [
        n("references: GenerationPromptReference[]", [q("d", "export interface GenerationPromptReference"), q("d", "export interface PromptReference")], [
          n("Identity + exact promptRepresentation", q("d", "export interface ReferenceIdentity"))
        ], ["GenerationPromptReference"]),
        n("omittedReferences: PromptReference[]", q("d", "export interface PromptReference"), [
          n("Remember the reference, leave its content out", ref("p", "excluded selection ->"))
        ])
      ], ["GenerationPromptConfigRecord"])
    ])
  ], ["createGenerationPromptConfig"]),
  n("Generation context and turns", ref("s", "async generate(setId"), [
    n("Prepare system / context / optional reference / mapping prompts", [q("p", "config: GenerationPromptConfigRecord"), q("p", "renderedContextPrompt:")], [
      n("Auxiliary views require the foundation and its evidence", [q("p", "if auxiliary: establish"), q("p", "if auxiliary: force")]),
      n("createCodeEntityPromptAliases(): readable, unambiguous evidence names", q("d", "export function createCodeEntityPromptAliases("))
    ], ["GenerationPromptConfigRecord"]),
    n("PiDiagramAgentRuntime.generateArtifact()", ref("a", "async generateArtifact(request, onProgress?) -> GeneratedArtifactDraft"), [
      n("Create a session with the submission tool and configured system prompt", [ref("a", "resourceLoader: sourceRoot, configured system prompt"), ref("a", "create in-memory session using only submit")]),
      n("runGenerationPromptTurns()", ref("a", "export async runGenerationPromptTurns("), [
        n("Initial prompt: generate and capture an artifact", ref("a", "prompt(initialPrompt);")),
        n("Optional reference turn: replace it with the revised artifact", q("a", "if referencePrompt")),
        n("Mapping turn: attach mappings to the unchanged final artifact", [ref("a", "onMappingTurn?(finalArtifact);"), ref("a", "require mapping submission")]),
        n("Submission validation rejects changed ASCII or invalid mappings", q("a", "if state.mappingSource"))
      ])
    ], ["runGenerationPromptTurns"]),
    n("DiagramApplication.generate(): persist accepted outputs", ref("s", "async generate(setId"), [
      n("Validate drafts; retry failed slots; reject duplicate ASCII", q("s", "retry pending slots")),
      n("DiagramRecord", ref("d", "export interface DiagramRecord"), [
        n("Link the prompt config, producer run and source diagrams", [ref("s", "mark validating; derive Diagram/component ancestry"), ref("s", "allocate unique output handles")]),
        n("Persist artifact and exact-ASCII mappings with the completed batch", [ref("s", "validate final entity maps"), ref("s", "complete runs and batch")])
      ], ["DiagramRecord"])
    ])
  ]),
  n("Derivative prompt history", ref("h", "buildDerivativePrompt("), [
    n("buildDerivativePrompt()", ref("h", "buildDerivativePrompt("), [
      n("Walk source artifact -> saved prompt config -> parent artifact", q("h", "while artifact exists"), [
        n("parentReference(): explicit derivation, otherwise first artifact reference", q("h", "parentReference(")),
        n("Stop at missing or previously visited artifacts/configs", ref("h", "mark artifact; resolve"))
      ]),
      n("Collect corrections and included / omitted historical references", [ref("h", "storedCorrection ="), ref("h", "collect references + omittedReferences")]),
      n("Render oldest-first history and append the current source token", [ref("h", "reverse corrections;"), q("h", "previousPromptBlock(")]),
      n("DerivativePromptDraft: prefix + historical references + derivation", q("h", "DerivativePromptDraft"))
    ], ["buildDerivativePrompt"])
  ]),
  n("Artifact portability", ref("d", "export interface MappedArtifactBundle"), [
    n("mappedArtifactBundle(): export", q("s", "async mappedArtifactBundle("), [
      n("artifactForDiagramSet(): locate local or imported artifact", q("s", "private async artifactForDiagramSet(")),
      n("Resolve declared evidence dependencies; reject missing entities", ref("s", "resolve declared dependencies;")),
      n("Attach the available spatial map", ref("s", "load mapping; imported artifacts"))
    ], ["mappedArtifactBundle"]),
    n("MappedArtifactBundle: transferable data", q("d", "export interface MappedArtifactBundle"), [
      n("Artifact + evidence records + optional codeEntityMap", q("d", "export interface MappedArtifactBundle")),
      n("Export and import are separate entry points", [ref("s", "async mappedArtifactBundle("), ref("s", "async importArtifact(")])
    ], ["MappedArtifactBundle"]),
    n("importArtifact(): import", ref("s", "async importArtifact("), [
      n("Validate artifact kind, name and ASCII", ref("s", "validate artifact kind, name")),
      n("If bundled: validate dependencies, provenance and mapping identity", q("s", "validate optional mapped bundle")),
      n("Persist imported evidence, artifact and optional map", [ref("s", "Diagram: preserve bundle"), ref("s", "component: preserve bundle")]),
      n("ImportedArtifactLibraryRecord", q("d", "export interface ImportedArtifactLibraryRecord"), [
        n("Index imported diagrams, components, evidence and maps", q("d", "export interface ImportedArtifactLibraryRecord")),
        n("Make imported material available for later prompt composition", ref("s", "load local/imported evidence and artifacts;"))
      ], ["ImportedArtifactLibraryRecord"])
    ], ["importArtifact"])
  ])
]);

// Attach narrow renderer/field ranges without selecting unrelated class members.
function visit(node, fn) { fn(node); node.children.forEach((child) => visit(child, fn)); }
visit(tree, (node) => {
  if (node.label === "Diagram: metadata + ASCII") node.refs.push(within("d", "export class Diagram", "prompt_str(", true));
  if (node.label === "Component: metadata + fragment ASCII") node.refs.push(within("d", "export class DiagramComponent", "prompt_str(", true));
  if (node.label === "targetId: intended target") node.refs.push(within("d", "export interface ReferenceIdentity", "targetId:"));
  if (node.label === "references: GenerationPromptReference[]") node.refs.push(within("d", "export interface GenerationPromptConfigRecord", "references:"));
  if (node.label === "omittedReferences: PromptReference[]") node.refs.push(within("d", "export interface GenerationPromptConfigRecord", "omittedReferences?:"));
});
const previous = JSON.parse(await readFile("docs/projections/prompt-reference-call-tree.json", "utf8"));
const catalog = JSON.parse(await readFile(".diagrams-parent-architecture/representations/catalog.json", "utf8"));
const source = catalog.revisions[previous.sourceRevisionId];
const priorProjection = Object.values(catalog.projections ?? {}).find((p) => p.sourceRepresentationId === previous.sourceRepresentationId
  && p.name === previous.name && catalog.representations[p.targetRepresentationId]?.status === "settled");
const evidenceId = (label) => {
  const entries = Object.values(source.evidence).filter((entry) => entry.label === label || entry.label === `${label}()`);
  assert.equal(entries.length, 1, `Unknown evidence ${label}`);
  return entries[0].id;
};
const ascii = [], links = [], compactionLinks = [];
function render(node, prefix = "", connector = "", childPrefix = "") {
  ascii.push(prefix + connector + node.label);
  const callTreeLine = ascii.length;
  if (node.evidence.length) links.push({ sourceEvidenceIds: node.evidence.map(evidenceId), targetLines: [callTreeLine] });
  for (const entry of node.refs) compactionLinks.push({ callTreeLine, ...entry });
  node.children.forEach((child, i) => {
    const last = i === node.children.length - 1;
    render(child, childPrefix, last ? "\\-- " : "+-- ", childPrefix + (last ? "    " : "|   "));
  });
}
render(tree);
assert.equal(new Set(links.flatMap((link) => link.sourceEvidenceIds)).size, Object.keys(source.evidence).length);
const result = { sourceRepresentationId: previous.sourceRepresentationId, sourceRevisionId: previous.sourceRevisionId,
  ...(priorProjection ? { targetRepresentationId: priorProjection.targetRepresentationId,
    expectedTargetRevisionId: catalog.representations[priorProjection.targetRepresentationId].currentRevisionId } : {}),
  name: previous.name, ascii: ascii.join("\n"), links,
  compactionProjection: { files: Object.values(files), links: compactionLinks } };
await writeFile("docs/projections/prompt-reference-call-tree.json", JSON.stringify(result, null, 2) + "\n");
console.log(`Generated ${ascii.length} call-tree rows, ${links.length} diagram links, ${compactionLinks.length} compaction links`);
