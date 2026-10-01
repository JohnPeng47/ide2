import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const DIAGRAM_STORAGE_VERSION = 2;
/** Missing markers are allowed for empty stores and pre-versioned current data;
 * domain validation still rejects old diagram payloads with a migration error. */
export async function assertDiagramStorageFormat(root: string): Promise<void> {
  let raw: string;
  try { raw = await readFile(path.join(root, 'diagram-storage-format.json'), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  const format = JSON.parse(raw);
  if (format.version !== DIAGRAM_STORAGE_VERSION)
    throw Error(`Unsupported diagram storage version ${format.version}; this app requires version ${DIAGRAM_STORAGE_VERSION}`);
}
