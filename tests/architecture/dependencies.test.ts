import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";

const root = fileURLToPath(new URL("../..", import.meta.url));
const config = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const resolutionCache = ts.createModuleResolutionCache(root, (file) => file, options);

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file) : /\.(ts|tsx)$/.test(file) ? [file] : [];
  });
}

function location(file: string) {
  const [runtime, area, feature] = path.relative(root, file).split(path.sep);
  const composition = runtime === "src" && (area === "app" || area === "main.tsx")
    || runtime === "server" && area === "app";
  const owner = runtime === "domain" ? area : area === "features" ? feature : "core";
  return { runtime, owner, composition, infrastructure: runtime === "server" && area === "infrastructure" };
}

it("preserves Core/Studio/Mapping ownership and browser/server/domain boundaries", () => {
  const violations: string[] = [];
  for (const runtime of ["src", "server", "domain"]) {
    for (const file of files(path.join(root, runtime))) {
      // Integration tests may exercise the composition root.
      if (/\.test\.tsx?$/.test(file)) continue;
      const from = location(file);
      const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      function visit(node: ts.Node) {
        let specifier: ts.Node | undefined;
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
        if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) specifier = node.argument.literal;
        if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
          || ts.isIdentifier(node.expression) && node.expression.text === "require")) specifier = node.arguments[0];
        if (specifier && ts.isStringLiteral(specifier)) {
          const name = specifier.text;
          const aliasedImport = Object.keys(options.paths ?? {}).some((pattern) => {
            const [prefix, suffix] = pattern.split("*");
            return suffix === undefined ? name === prefix : name.startsWith(prefix) && name.endsWith(suffix);
          });
          // Relative imports already identify the owning directory. Resolve only
          // aliases through TypeScript to avoid filesystem probing for every edge.
          const resolved = aliasedImport
            ? ts.resolveModuleName(name, file, options, ts.sys, resolutionCache).resolvedModule
            : undefined;
          const target = name.startsWith(".") ? path.resolve(path.dirname(file), name)
            : resolved && !resolved.isExternalLibraryImport ? resolved.resolvedFileName : undefined;
          const externalRuntime = /^(?:node:|react(?:-dom)?(?:\/|$)|vite(?:\/|$))/.test(name);
          let invalid = from.runtime === "domain" && externalRuntime
            || from.runtime === "src" && name.startsWith("node:");
          if (target) {
            const to = location(target);
            const runtimeAllowed = from.runtime === "domain" ? to.runtime === "domain"
              : from.runtime === "src" ? ["src", "domain", "packages"].includes(to.runtime)
                : ["server", "domain"].includes(to.runtime);
            const ownershipAllowed = from.composition || !to.composition && (to.owner === "core" || to.owner === from.owner);
            const infrastructureAllowed = !from.infrastructure || to.runtime === "domain" || to.infrastructure;
            invalid ||= !runtimeAllowed || !ownershipAllowed || !infrastructureAllowed;
          }
          if (invalid) violations.push(`${path.relative(root, file)} imports ${name}`);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  expect(violations).toEqual([]);
});
