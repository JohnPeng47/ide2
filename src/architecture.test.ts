import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const areas = ["core", "studio", "mapping"] as const;

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file) : /\.(ts|tsx)$/.test(file) ? [file] : [];
  });
}

it("keeps Core independent and features dependent only on themselves and Core", () => {
  const violations: string[] = [];
  for (const layer of ["src", "server"]) {
    for (const area of areas) {
      for (const file of files(path.join(root, layer, area))) {
        // Integration tests may exercise the composition root.
        if (/\.test\.tsx?$/.test(file)) continue;
        const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
        function visit(node: ts.Node) {
          let specifier: ts.Node | undefined;
          if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
          if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) specifier = node.argument.literal;
          if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) specifier = node.arguments[0];
          if (specifier && ts.isStringLiteral(specifier) && specifier.text.startsWith(".")) {
            const target = path.relative(root, path.resolve(path.dirname(file), specifier.text));
            const [targetLayer, targetArea] = target.split(path.sep);
            if ((targetLayer === "src" || targetLayer === "server")
              && (targetArea !== "core" && targetArea !== area || layer === "src" && targetLayer === "server")) {
              violations.push(`${path.relative(root, file)} imports ${target}`);
            }
          }
          ts.forEachChild(node, visit);
        }
        visit(source);
      }
    }
  }
  expect(violations).toEqual([]);
});
