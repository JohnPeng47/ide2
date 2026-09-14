import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import ts from "typescript";

const defaults = ["src-domain", "src-refBuffer", "src-referenceResolver", "src-prompt", "src-derivativePrompt", "server-agentRuntime", "server-application"];
const stems = process.argv.slice(2).length ? process.argv.slice(2) : defaults;
const summaries = [];
for (const stem of stems) {
  const file = `docs/compactions/${stem}.json`;
  const map = JSON.parse(readFileSync(file, "utf8"));
  const sourceBytes = readFileSync(map.sourceFile);
  const source = sourceBytes.toString("utf8");
  const sourceLines = source.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  assert.equal(map.sourceSha256, createHash("sha256").update(sourceBytes).digest("hex"), `${file}: source snapshot changed`);
  assert.equal(map.treeFile, `docs/compactions/${stem}.txt`, `${file}: unexpected tree path`);
  const tree = readFileSync(map.treeFile, "utf8");
  assert(!/[^\x20-\x7e\n]/.test(tree), `${file}: tree must contain printable ASCII and LF only`);
  assert(!tree.includes("```"), `${file}: tree contains Markdown fences`);
  assert(!tree.includes("..."), `${file}: tree contains ellipses`);
  const rows = tree.replace(/\n$/, "").split("\n");
  assert.equal(rows[0], map.sourceFile, `${file}: root must be source path`);
  const semantic = new Set(rows.flatMap((row, index) => /^[\s|+\\`<>^-]*$/.test(row) ? [] : [index + 1]));
  assert(Array.isArray(map.mappings), `${file}: missing mappings`);
  const mapped = new Set();
  for (const entry of map.mappings) {
    assert(Number.isInteger(entry.treeLine) && semantic.has(entry.treeLine), `${file}: invalid semantic tree row ${entry.treeLine}`);
    assert(!mapped.has(entry.treeLine), `${file}: duplicate mapping for row ${entry.treeLine}`);
    mapped.add(entry.treeLine);
    assert(Array.isArray(entry.sourceRanges) && entry.sourceRanges.length, `${file}: missing source ranges for row ${entry.treeLine}`);
    for (const range of entry.sourceRanges) {
      assert(Number.isInteger(range.startLine) && Number.isInteger(range.endLine)
        && range.startLine >= 1 && range.endLine >= range.startLine && range.endLine <= sourceLines.length,
      `${file}: invalid source range on tree row ${entry.treeLine}`);
    }
  }
  assert.deepEqual([...mapped].sort((a,b)=>a-b), [...semantic], `${file}: not every semantic row is mapped`);
  // Check named top-level declarations and class methods independently of broad root ranges.
  const ast = ts.createSourceFile(map.sourceFile, source, ts.ScriptTarget.Latest, true);
  const declarations = [];
  const declaration = (name, node) => declarations.push({ name,
    startLine: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
    endLine: ast.getLineAndCharacterOfPosition(node.end).line + 1 });
  for (const statement of ast.statements) {
    if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) continue;
    if (statement.name) declaration(statement.name.getText(ast), statement);
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) declarations.push({ name: declaration.name.text,
          startLine: ast.getLineAndCharacterOfPosition(declaration.getStart(ast)).line + 1,
          endLine: ast.getLineAndCharacterOfPosition(declaration.end).line + 1 });
      }
    }
    if (ts.isClassDeclaration(statement)) {
      for (const member of statement.members) {
        if ((ts.isMethodDeclaration(member) || ts.isGetAccessorDeclaration(member)
          || ts.isSetAccessorDeclaration(member)) && member.name) declaration(member.name.getText(ast), member);
      }
    }
  }
  const absent = declarations.filter((declaration) => !map.mappings.some((entry) => rows[entry.treeLine - 1].includes(declaration.name)
    && entry.sourceRanges.some((range) => range.startLine <= declaration.endLine && range.endLine >= declaration.startLine)))
    .map(({name, startLine}) => `${name}:${startLine}`);
  assert.deepEqual(absent, [], `${file}: missing declarations or methods`);
  summaries.push({ sourceFile: map.sourceFile, sourceLines: sourceLines.length, treeLines: rows.length,
    mappedLines: mapped.size, checkedDeclarations: declarations.length });
}
console.log(JSON.stringify(summaries, null, 2));
