import {
  type WorkspaceSnapshot
} from "../../../domain/core/records/domain";
import type { CoreContext } from '../context';
import { loadWorkspace } from "./loadWorkspace";

export function workspace(context: CoreContext): Promise<WorkspaceSnapshot> {
  return loadWorkspace(context.store);
}
