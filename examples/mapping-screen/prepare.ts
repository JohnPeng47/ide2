import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { buildTreeRepresentationIndex } from "../../domain/core/representations/representationIndex";

// Run from the repository root. Preparation only writes this example's artifacts.
const output = "examples/mapping-screen";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const choices = [
  ["MappingScreen", "src/features/mapping/MappingPage.tsx", "MappingPocPage", "Loads project representations, retains document drafts, and composes the Mapping screen."],
  ["MappingSubmenu", "src/features/mapping/workspace/MappingSubmenu.tsx", "MappingSubmenu", "Displays the project, editable name, creation/save actions, and status."],
  ["NewDiagramAction", "src/features/mapping/MappingPage.tsx", "create", "Creates a canvas from entered ASCII or a copy of the active document."],
  ["SaveDiagramAction", "src/features/mapping/MappingPage.tsx", "save", "Saves a captured draft against its expected project revision."],
  ["CanvasViewport", "src/shared/diagrams/DraggableDiagramCanvas.tsx", "DraggableDiagramCanvas", "Controls canvas pan, zoom, recentering, pointer gestures, and focus."],
  ["CenterAndReset", "src/shared/diagrams/DraggableDiagramCanvas.tsx", "resetCanvas", "Computes a centered transform with an inset for the explorer."],
  ["GridBox", "domain/core/diagrams/lineGrid.ts", "GridBox", "Recursive discriminated union of diagram boxes and container boxes."],
  ["Scene", "domain/core/diagrams/lineGrid.ts", "resolveScene", "Resolves recursive box sizes, positions, collapsed content, and absolute bounds."],
  ["SelectionInteraction", "src/features/mapping/canvas/MappingCanvas.tsx", "finishSelection", "Converts the completed drag to a rectangle and selects intersecting mapped labels."],
  ["GenerateSubDiagram", "src/features/mapping/canvas/MappingCanvas.tsx", "generateAt", "Generates ASCII for a requested region, inserts a diagram, and settles its layout."],
  ["PromptSelection", "src/features/mapping/canvas/MappingCanvas.tsx", "submitPrompt", "Applies a source-backed edit or begins sub-diagram placement."],
  ["ProjectionCompanion", "src/features/mapping/canvas/MappingCanvas.tsx", "MappingPocSelectionCanvas: aside.mapping-poc-companion", "Renders the enclosing projection panel, header controls, and call-tree or source-compaction body."],
  ["ProjectedCallTree", "domain/core/diagrams/diagramProjection.ts", "projectSelection", "OR-matches evidence, expands matched subtrees, and adds ancestors for display."],
  ["ProjectedSourceCompactions", "domain/core/representations/compactionProjection.ts", "projectCompactions", "Projects exact compaction rows with ancestors, excluding unrelated descendants."],
  ["LocalConversation", "src/features/mapping/chat/LocalChatConvo.tsx", "LocalChatConvo", "Renders the transcript, pending/error state, verbosity control, and follow-up composer."],
  ["ProjectExplorer", "src/features/mapping/workspace/MappingDiagramExplorer.tsx", "MappingDiagramExplorer", "Filters project diagrams and renders the active canvas box hierarchy."],
];

interface Row { label: string; startLine: number; endLine: number; symbol?: string; children: Row[] }
const ascii = await readFile(`${output}/diagram.txt`, "utf8");
assert(!/[^\x20-\x7e\n]/.test(ascii), "Diagram must be printable ASCII with LF newlines");
const files = [];
const symbols = new Map<string, { row: Row; treeLines: number[] }>();
await mkdir(`${output}/compactions`, { recursive: true });

for (const sourceFile of [...new Set(choices.map((choice) => choice[1]))]) {
  const source = await readFile(sourceFile, "utf8");
  const ast = ts.createSourceFile(sourceFile, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const physicalLines = source.split("\n").length - Number(source.endsWith("\n"));
  const text = (node: ts.Node) => node.getText(ast).replace(/\s+/g, " ").replace(/[^\x20-\x7e]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
  function collect(node: ts.Node): Row[] {
    let label: string | undefined;
    let symbol: string | undefined;
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "aside"
      && node.openingElement.attributes.properties.some((property) => ts.isJsxAttribute(property)
        && property.name.getText(ast) === "className" && property.initializer
        && ts.isStringLiteral(property.initializer) && property.initializer.text === "mapping-poc-companion")) {
      symbol = "MappingPocSelectionCanvas: aside.mapping-poc-companion";
      label = '<aside className="mapping-poc-companion"> in MappingPocSelectionCanvas';
    } else if (ts.isImportDeclaration(node)) label = text(node);
    else if (ts.isFunctionDeclaration(node) && node.name) {
      symbol = node.name.text;
      label = `function ${symbol}(${node.parameters.map((parameter) => text(parameter.name)).join(", ")})`;
    } else if ((ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
      symbol = node.name.text;
      label = `${ts.isInterfaceDeclaration(node) ? "interface" : ts.isClassDeclaration(node) ? "class" : "type"} ${symbol}`;
    } else if (ts.isVariableDeclaration(node)) {
      symbol = ts.isIdentifier(node.name) ? node.name.text : undefined;
      const init = node.initializer;
      label = text(node.name) + (init && ts.isArrowFunction(init) ? `(${init.parameters.map((parameter) => text(parameter.name)).join(", ")})`
        : init && ts.isCallExpression(init) ? ` = ${text(init.expression)}()`
        : node.type ? `: ${text(node.type)}` : " [binding]");
    } else if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) {
      symbol = text(node.name);
      label = `${symbol}(${node.parameters.map((parameter) => text(parameter.name)).join(", ")})`;
    } else if (ts.isPropertySignature(node)) label = text(node);
    else if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
      && /^(useEffect|useLayoutEffect)$/.test(text(node.expression.expression))) {
      label = `${text(node.expression.expression)} callback`;
    } else if (ts.isReturnStatement(node) && node.expression
      && /<\w/.test(node.expression.getText(ast)) && node.expression.getText(ast).trim().startsWith("(")) {
      label = "render JSX";
    }
    const children: Row[] = [];
    // Import bindings and type properties have already been fully represented.
    if (!ts.isImportDeclaration(node) && !ts.isPropertySignature(node)) node.forEachChild((child) => { children.push(...collect(child)); });
    if (!label) return children;
    const summary = choices.find((choice) => choice[1] === sourceFile && choice[2] === symbol)?.[3];
    return [{ label: label + (summary ? ` - ${summary}` : ""), symbol,
      startLine: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
      endLine: ast.getLineAndCharacterOfPosition(Math.max(node.getStart(ast), node.end - 1)).line + 1, children }];
  }
  const root: Row = { label: sourceFile, startLine: 1, endLine: physicalLines, children: collect(ast) };
  const lines: string[] = [];
  const mappings: { treeLine: number; sourceRanges: { startLine: number; endLine: number }[] }[] = [];
  function render(row: Row, prefix = "", connector = "", childPrefix = "") {
    const first = lines.length + 1;
    lines.push(prefix + connector + row.label);
    assert(row.startLine >= 1 && row.endLine >= row.startLine && row.endLine <= physicalLines);
    mappings.push({ treeLine: first, sourceRanges: [{ startLine: row.startLine, endLine: row.endLine }] });
    row.children.forEach((child, index) => {
      const last = index === row.children.length - 1;
      render(child, childPrefix, last ? "\\-- " : "+-- ", childPrefix + (last ? "    " : "|   "));
    });
    if (row.symbol && choices.some((choice) => choice[1] === sourceFile && choice[2] === row.symbol)) {
      const key = `${sourceFile}:${row.symbol}`;
      assert(!symbols.has(key), `Ambiguous symbol: ${key}`);
      symbols.set(key, { row, treeLines: Array.from({ length: lines.length - first + 1 }, (_, i) => first + i) });
    }
  }
  render(root);
  const tree = lines.join("\n") + "\n";
  const treeFile = `${output}/compactions/${sourceFile.replace(/\//g, "-").replace(/\.tsx?$/, "")}.txt`;
  const sourceSha256 = hash(source);
  const index = buildTreeRepresentationIndex({ revision: { artifactId: sourceFile, asciiSha256: hash(tree) }, ascii: tree });
  assert.equal(Object.keys(index.nodes).length, mappings.length, "Every semantic compaction row must be indexed and mapped");
  await writeFile(treeFile, tree);
  await writeFile(treeFile.replace(/\.txt$/, ".json"), JSON.stringify({ sourceFile, sourceSha256, treeFile, mappings }, null, 2) + "\n");
  files.push({ sourceFile, sourceSha256, ascii: tree, asciiSha256: hash(tree), mappings });
}

const codeEntities = choices.map(([label, file, symbol, summary]) => {
  const found = symbols.get(`${file}:${symbol}`);
  assert(found, `Missing source symbol: ${file}:${symbol}`);
  const key = label.replace(/[A-Z]/g, (letter, i) => (i ? "-" : "") + letter.toLowerCase());
  return { key, handle: `mapping-screen-${key}`, label, summary,
    category: symbol === "GridBox" ? "interface-data-struct" : "operation",
    sourceRanges: [{ key: "implementation", path: file, startLine: found.row.startLine, endLine: found.row.endLine, symbol }] };
});
const mappings = codeEntities.map((entity) => {
  const matches = ascii.split("\n").flatMap((line, i) => {
    const column = line.indexOf(entity.label);
    return column >= 0 && /^[ |+\\-]*$/.test(line.slice(0, column))
      && !/[A-Za-z]/.test(line[column + entity.label.length] ?? "")
      ? [{ entityKey: entity.key, sourceRangeKey: "implementation", line: i + 1,
        startColumn: column + 1, endColumn: column + entity.label.length }] : [];
  });
  assert.equal(matches.length, 1, `Expected one exact diagram label: ${entity.label}`);
  return matches[0];
});
const tree = ["Mapping screen implementation (containment and handlers)"];
const links: { handle: string; targetLines: number[] }[] = [];
const compactionLinks: { callTreeLine: number; file: string; treeLines: number[] }[] = [];
files.forEach((file, i) => {
  const lastFile = i === files.length - 1;
  tree.push((lastFile ? "\\-- " : "+-- ") + file.sourceFile);
  const entities = codeEntities.filter((entity) => entity.sourceRanges[0].path === file.sourceFile);
  entities.forEach((entity, j) => {
    const symbol = entity.sourceRanges[0].symbol;
    tree.push((lastFile ? "    " : "|   ") + (j === entities.length - 1 ? "\\-- " : "+-- ") + `${entity.label} -> ${symbol}`);
    links.push({ handle: entity.handle, targetLines: [tree.length] });
    compactionLinks.push({ callTreeLine: tree.length, file: file.sourceFile,
      treeLines: symbols.get(`${file.sourceFile}:${symbol}`)!.treeLines });
  });
});
await writeFile(`${output}/implementation.txt`, tree.join("\n") + "\n");
const bundle = {
  materialized: { creationMode: "materialized", name: "Mapping screen architecture", domainProfileId: "source-code",
    description: "User-supplied Mapping UI tree with deliberately partial implementation mappings.", codeEntities,
    diagrams: [{ key: "mapping-screen", name: "Mapping screen architecture", ascii, viewKind: "diagram",
      representationKind: "tree", codeEntityKeys: codeEntities.map((entity) => entity.key), mappings }] },
  projection: { name: "Mapping screen implementation", ascii: tree.join("\n") + "\n", links,
    compactionProjection: { files, links: compactionLinks } }
};
await writeFile(`${output}/prepared.json`, JSON.stringify(bundle, null, 2) + "\n");
console.log(JSON.stringify({ mappedNodes: mappings.length, sourceFiles: files.length,
  compactionRows: files.reduce((sum, file) => sum + file.mappings.length, 0), output: path.resolve(output) }, null, 2));
