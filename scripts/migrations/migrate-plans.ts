import path from "node:path";
import { migrateLegacyPlanBundles } from "../../server/core/persistence/planMigration";
import { DiagramStore } from "../../server/core/persistence/store";

const args = process.argv.slice(2);
const directoryFlag = args.indexOf("--diagrams-dir");
const diagramsDirectory = directoryFlag >= 0 ? args[directoryFlag + 1] : ".diagrams";
const positional = args.filter((_, index) => index !== directoryFlag && index !== directoryFlag + 1);
const checkoutRoot = path.resolve(positional[0] ?? process.cwd());

if (!diagramsDirectory) throw new Error("--diagrams-dir requires a value");

const result = await migrateLegacyPlanBundles(new DiagramStore(checkoutRoot, diagramsDirectory));
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
