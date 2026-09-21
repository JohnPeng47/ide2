import path from "node:path";
import type { PersistenceContext } from './context';

export function projectPath(context: PersistenceContext): string {
  return path.join(context.storeRoot, "project.json");
}
