import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const storeRoot = path.join(root, ".diagrams");
const sourceDirectory = path.join(storeRoot, "sources");
const transcriptRelativePath = ".diagrams/sources/brendan-foody-20vc-transcript.txt";
const transcriptPath = path.join(root, transcriptRelativePath);
const graphPath = path.join(sourceDirectory, "brendan-foody-20vc-call-graph.txt");

const graph = readFileSync(graphPath, "utf8").replace(/\r\n?/g, "\n").trimEnd();
const transcript = readFileSync(transcriptPath, "utf8").replace(/\r\n?/g, "\n");
const transcriptLines = transcript.split("\n");

if (/[^\x00-\x7f]/.test(graph)) {
  throw new Error("The persisted diagram must contain only 7-bit ASCII");
}

// Exact plaintext ranges for every terminal graph node. Several leaves may
// legitimately point at one sentence when Foody makes multiple claims in it,
// but no mapping spans an entire topical section anymore.
const leafSourceLines = new Map(Object.entries({
  7: 13, 8: 12, 9: 12, 10: 13, 11: 14,
  16: [68, 69], 17: [70, 71], 18: 72, 19: 73, 21: 75, 22: 75,
  24: 115, 25: 115, 26: 116, 28: [126, 127], 29: 128, 30: [128, 129], 31: [105, 106],
  36: [143, 144], 42: 150, 44: 151, 45: 151, 46: 151, 47: [151, 152],
  50: 150, 51: 150, 52: 152, 55: 151, 56: 152, 57: 152,
  60: 186, 61: 189, 62: 187, 63: 187, 66: 198, 67: 199, 68: 199,
  71: [199, 200], 72: 199,
  76: [156, 157], 80: 162, 81: 163, 82: 163, 85: 164, 86: 164, 87: 164, 88: 164,
  91: 161, 95: [319, 320], 96: [319, 321], 97: 165, 98: 165, 99: 165, 100: 164,
  103: 288, 104: 288, 107: 298, 108: [297, 298], 111: 299, 112: 299,
  117: [173, 174], 118: 174, 119: [174, 175], 122: 187, 123: 187, 124: 221,
  127: 211, 130: 209, 131: 211, 132: 221, 133: 211,
  138: 232, 140: 233, 141: [233, 235], 144: 267, 145: [265, 267], 146: 247,
  147: [265, 266], 150: 276, 151: 277, 154: 278, 155: 278, 156: 278, 157: 278, 159: 279,
  164: 309, 165: 309, 168: 309, 169: 309, 170: 309, 173: 319,
  174: [320, 321], 175: 321, 176: 321, 179: 448, 180: 448, 181: 448,
  185: 330, 186: 406, 188: 342, 189: 343, 190: 345, 191: 257, 192: 257,
  196: 343, 197: 345, 198: 346, 200: 356, 202: 347, 203: 347, 204: 396,
  207: [363, 369], 208: 378, 209: [396, 397], 210: 397, 213: 406, 214: 407,
  215: [415, 416], 218: 433, 219: 433, 220: 434,
  225: 446, 226: 446, 227: 447, 230: [459, 460], 231: 460, 232: 461,
  235: 471, 236: 471, 237: 472, 240: 481, 241: [482, 483], 244: 500,
  245: 508, 246: [517, 519], 249: 527, 250: 527, 251: [528, 529],
  254: 537, 255: 538, 256: 539,
  261: 557, 262: 558, 263: 558, 266: 575, 267: 575, 268: 575, 269: 576,
  272: 585, 273: 585, 274: 593, 275: [594, 595], 278: 604, 279: 605,
  284: 614, 285: 615, 286: 616, 287: [617, 618], 290: 645, 291: [645, 646],
  294: [656, 657], 297: 673, 298: 673, 299: 673, 302: 673, 303: [709, 711],
  304: 709, 307: 721, 308: 721, 309: 673, 310: [722, 723], 313: 740, 314: [748, 749],
  319: [771, 772], 322: 780, 323: 781, 326: 798, 329: 840, 330: 841,
  333: [850, 851], 336: [872, 873], 340: 883, 342: 883, 343: 883,
  347: 891, 348: 891, 349: 891, 350: 891, 351: 891, 353: [899, 954]
}).map(([line, range]) => [Number(line), Array.isArray(range) ? range : [range, range]]));

function digest(value, length = 32) {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function slugify(value) {
  return value.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function timestampAtLine(lineNumber) {
  for (let index = lineNumber - 1; index >= 0; index -= 1) {
    const match = /^\[(\d{2}:\d{2})\]$/.exec(transcriptLines[index]);
    if (match) return match[1];
  }
  return "00:00";
}

const repositoryIdentity = `filesystem-documents:${root}`;
const gitRevision = execFileSync(
  "git",
  ["rev-parse", "HEAD"],
  { cwd: root, encoding: "utf8" }
).trim();

const createdAt = "2026-08-29T00:00:00.000Z";
const documentIdentificationCriteria = `## Evidence significance

A useful evidence entity is a diagram-relevant concept grounded in the supplied
documents. It helps explain the requested chronology, argument, relationship,
event, decision, or recurring theme.

An evidence entity may cover multiple related passages when they collectively
support one concept. Give each entity a concise label and summary and exact
corpus-relative document ranges. Descriptions must stay within what those
passages support.

Strong candidates include claims, decisions, events, actors, definitions,
contrasts, causal links, and transitions that connect the requested diagram
concepts.`;
const documentCompactionCriteria = `## Evidence presentation

Preserve the meaningful statements, surrounding context, chronology, and
relationships in each cited passage while omitting unrelated detail.

For every evidence range, provide a continuous compactedSource presentation.
Retained sections quote the relevant document lines. Collapsed-comment sections
summarize only material supported by their exact span using concise 7-bit ASCII.
Map each semantic summary node to the exact lines that support it. Blank and
connector-only lines have no mapping.

The server snapshots the original document lines after validating every
submitted coordinate.`;
const projectId = `project-${digest(repositoryIdentity, 12)}`;
const setId = "set-brendan-foody-20vc";
const codeEntitiesSetId = "entities-brendan-foody-20vc";
const diagramId = "diagram-brendan-foody-20vc-call-graph";
const mappingRunId = "run-brendan-foody-20vc-mapping";

const graphLines = graph.split("\n");
const branchPattern = /([+`\\|])--(?:\[([^\]]+)\]--)?(?:>|(?=\s))\s*(.*)$/;
const nodes = graphLines.flatMap((line, index) => {
  const match = branchPattern.exec(line);
  return match ? [{
    graphLine: index + 1,
    column: match.index,
    label: match[3].trim(),
    children: []
  }] : [];
});
const ancestors = [];
for (const node of nodes) {
  while (ancestors.at(-1)?.column >= node.column) ancestors.pop();
  ancestors.at(-1)?.children.push(node);
  ancestors.push(node);
}
const leaves = nodes.filter((node) => node.graphLine < 355 && node.children.length === 0);
const leafLineSet = new Set(leaves.map((leaf) => leaf.graphLine));
const missingRanges = leaves.filter((leaf) => !leafSourceLines.has(leaf.graphLine));
const nonLeafRanges = [...leafSourceLines.keys()].filter((line) => !leafLineSet.has(line));
if (missingRanges.length || nonLeafRanges.length) {
  throw new Error([
    missingRanges.length ? `Leaves missing transcript ranges: ${missingRanges.map((leaf) => leaf.graphLine).join(", ")}` : "",
    nonLeafRanges.length ? `Transcript ranges assigned to non-leaves: ${nonLeafRanges.join(", ")}` : ""
  ].filter(Boolean).join("\n"));
}

const entities = [];
const mappings = [];
for (const leaf of leaves) {
  const [startLine, endLine] = leafSourceLines.get(leaf.graphLine);
  if (startLine < 1 || endLine < startLine || endLine > transcriptLines.length) {
    throw new Error(`Invalid transcript range ${startLine}-${endLine} for graph line ${leaf.graphLine}`);
  }
  const handle = `leaf-${String(leaf.graphLine).padStart(3, "0")}-${slugify(leaf.label)}`;
  const entityId = `entity-${digest(`${setId}:${handle}`)}`;
  const rangeId = `range-${digest(`${entityId}:${transcriptRelativePath}:${startLine}:${endLine}`)}`;
  const timestamp = timestampAtLine(startLine);
  const entity = {
    id: entityId,
    origin: {
      projectId,
      diagramSetId: setId,
      codeEntitiesSetId
    },
    handle,
    label: leaf.label,
    category: "state",
    summary: `Terminal interview-map claim grounded at ${timestamp}, plaintext lines ${startLine}-${endLine}.`,
    sourceRanges: [{
      id: rangeId,
      path: transcriptRelativePath,
      startLine,
      endLine,
      symbol: `${timestamp} · graph line ${leaf.graphLine}`,
      originalLines: transcriptLines.slice(startLine - 1, endLine)
    }]
  };
  entities.push(entity);
  const line = graphLines[leaf.graphLine - 1];
  const startIndex = line.search(/[a-z0-9_[({]/i);
  const visibleText = line.slice(startIndex).trimEnd();
  mappings.push({
    id: `map-${mappings.length + 1}`,
    entityId: entity.id,
    sourceRangeId: entity.sourceRanges[0].id,
    sourceRangeIndex: 0,
    line: leaf.graphLine,
    startColumn: startIndex + 1,
    endColumn: startIndex + visibleText.length
  });
}

const diagramDirectory = path.join(storeRoot, "diagram-sets", setId);
const writeJson = (filePath, value) => {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

writeJson(path.join(storeRoot, "project.json"), {
  schemaVersion: 1,
  id: projectId,
  name: path.basename(root),
  repositoryIdentity,
  canonicalRepoRoot: root,
  domainProfileId: "document",
  corpus: { kind: "filesystem-documents", root },
  diagramSetIds: [setId],
  createdAt,
  updatedAt: createdAt
});

writeJson(path.join(diagramDirectory, "diagram-set.json"), {
  schemaVersion: 1,
  id: setId,
  projectId,
  name: "Brendan Foody 20VC Interview",
  initialPrompt: "Represent Brendan Foody's 20VC interview as a detailed chronological ASCII tree and link its claims to the formatted plaintext transcript.",
  sourceCheckoutRoot: root,
  gitRevision,
  codeEntitiesSetId,
  featuredViewIds: { diagram: diagramId },
  diagramIds: [diagramId],
  diagramComponentIds: [],
  generationBatchIds: [],
  agentRunIds: [mappingRunId],
  editSessionIds: [],
  readiness: "ready",
  createdAt,
  updatedAt: createdAt
});

writeJson(path.join(storeRoot, "code-entity-prompt-templates.json"), {
  schemaVersion: 1,
  templates: [{
    schemaVersion: 1,
    id: "default-code-entities",
    label: "Default Document Evidence",
    description: "Document-grounded evidence identification and passage presentation.",
    builtIn: true,
    version: 1,
    prompts: {
      "code-entity-identification": documentIdentificationCriteria,
      "code-entity-compaction": documentCompactionCriteria
    },
    createdAt,
    updatedAt: createdAt
  }]
});

writeJson(path.join(diagramDirectory, "code-entities.json"), {
  schemaVersion: 1,
  id: codeEntitiesSetId,
  diagramSetId: setId,
  revision: 2,
  status: "finalized",
  entities,
  finalizedAt: createdAt
});

writeJson(path.join(diagramDirectory, "diagrams", `${diagramId}.json`), {
  schemaVersion: 1,
  id: diagramId,
  recordOrigin: { projectId, diagramSetId: setId },
  diagramSetId: setId,
  viewKind: "diagram",
  handle: "brendan-foody-20vc-call-graph",
  name: "Brendan Foody Interview Call Graph",
  ascii: graph,
  representationKind: "tree",
  codeEntityIds: entities.map((entity) => entity.id),
  // A local persisted artifact must not use `imported`: the store reserves that
  // value for legacy artifacts that it migrates into the global import library.
  origin: "generated",
  derivedFromDiagramIds: [],
  createdAt
});

writeJson(path.join(diagramDirectory, "code-entity-maps", `${diagramId}.json`), {
  schemaVersion: 1,
  diagramSetId: setId,
  artifactKind: "diagram",
  artifactId: diagramId,
  asciiSha256: createHash("sha256").update(graph).digest("hex"),
  mappings,
  producedByRunId: mappingRunId,
  createdAt
});

writeJson(path.join(diagramDirectory, "runs", `${mappingRunId}.json`), {
  schemaVersion: 1,
  id: mappingRunId,
  diagramSetId: setId,
  kind: "map-code-entities",
  status: "complete",
  statusMessage: `mapped ${mappings.length} terminal call-graph claims to granular transcript ranges`,
  codeEntitiesRevision: 2,
  outputCodeEntityIds: entities.map((entity) => entity.id),
  outputDiagramId: diagramId,
  startedAt: createdAt,
  updatedAt: createdAt,
  completedAt: createdAt
});

console.log(JSON.stringify({
  projectId,
  setId,
  diagramId,
  entityCount: entities.length,
  mappingCount: mappings.length,
  transcriptLineCount: transcriptLines.length,
  graphLineCount: graphLines.length
}, null, 2));
