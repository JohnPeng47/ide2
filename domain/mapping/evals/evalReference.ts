import { projectionTypeSchema } from '../projections/projectionType';
import { z } from 'zod';
import { asciiFromClipboardText } from '../../core/diagrams/diagramClipboard';
import { compareSourceSchema, type CompareSource } from '../compare/comparePageSession';

/** A named ASCII excerpt copied from part of a diagram, cited in prompt templates as `{{ref:<id>}}`.
 * The text is frozen at creation, so prompt versions that cite it never change meaning. */
export interface EvalReference {
  schemaVersion: 1; id: string; projectId: string; requestId: string; name: string; ascii: string;
  /** Where the excerpt was copied from: the canvas or view, pinned to a checkpoint. */
  source: CompareSource; sourceName: string; canvasName: string;
  /** The diagram the excerpt was selected from. Older references only name the canvas. */
  diagramName?: string;
  /** Optional guidance from the author, placed with the excerpt in prompts that cite it. Runs pin the comment they started with. */
  comment?: string;
  /** References without a group, or whose group was deleted, are ungrouped. */
  groupId?: string;
  createdAt: string; updatedAt: string;
  /** Archived references leave the list but still resolve for prompts that cite them. */
  archivedAt?: string;
}
/** A named set of references. Groups only organize the library: prompts cite references, never groups. */
export interface EvalReferenceGroup { schemaVersion: 1; id: string; projectId: string; requestId: string; name: string; createdAt: string; updatedAt: string }
export const evalReferenceIdPattern = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const createEvalReferenceSchema = z.object({
  requestId: z.string().uuid(), name: z.string().trim().min(1).max(120), ascii: z.string().max(50_000).refine(text => text.trim().length > 0, 'The excerpt is empty.'),
  source: compareSourceSchema, sourceName: z.string().max(200), canvasName: z.string().max(200),
  diagramName: z.string().max(200).optional(), groupId: z.string().min(1).max(80).optional(), comment: z.string().trim().max(5000).optional()
}).strict();
/** A null `groupId` moves the reference out of its group; an empty `comment` removes the comment. */
export const updateEvalReferenceSchema = z.object({ name: z.string().trim().min(1).max(120).optional(), archived: z.boolean().optional(), groupId: z.string().min(1).max(80).nullable().optional(), comment: z.string().trim().max(5000).optional() }).strict();
export const createEvalReferenceGroupSchema = z.object({ requestId: z.string().uuid(), name: z.string().trim().min(1).max(120) }).strict();
export const updateEvalReferenceGroupSchema = z.object({ name: z.string().trim().min(1).max(120) }).strict();
export const captureCanvasSchema = z.object({ projectionType: projectionTypeSchema.optional(), source: compareSourceSchema }).strict();

/** Readable, stable IDs: the token in a prompt names what it cites. */
export function referenceSlug(name: string, taken: ReadonlySet<string>) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'reference';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

const TREE_ROW = /^[\s|│]*[|+`\\├└][-─]+\s/;
const ROOT_CONNECTOR = /^[|+`\\├└][-─]+\s+/;
const RAILS_ONLY = /^[\s|│]*$/;
const LEADING_RAIL = /^[|│](?=\s|$)/;
const indentOf = (row: string) => row.length - row.trimStart().length;
const dedent = (rows: string[]) => {
  const indent = Math.min(...rows.filter(Boolean).map(indentOf));
  return rows.map(row => row.slice(indent));
};

/**
 * The text a reference keeps from a canvas selection: the diagram rows only, re-rooted at what was selected.
 * Selections copy complete rows, so a subtree arrives with the rails of its unselected ancestors and the connector
 * joining it to its parent. Selections holding several top-level branches keep their connectors. Text that is not a tree is only dedented.
 */
export function referenceExcerpt(selection: string): string {
  let rows = asciiFromClipboardText(selection).split('\n').map(row => row.trimEnd());
  const tree = rows.some(row => TREE_ROW.test(row));
  const empty = tree ? (row: string) => RAILS_ONLY.test(row) : (row: string) => !row;
  while (rows.length && empty(rows[0])) rows.shift();
  while (rows.length && empty(rows[rows.length - 1])) rows.pop();
  if (!rows.length) return '';
  rows = dedent(rows);
  if (!tree) return rows.join('\n');
  while (rows.every(row => !row || LEADING_RAIL.test(row))) rows = dedent(rows.map(row => row.slice(1)));
  const width = rows[0].match(ROOT_CONNECTOR)?.[0].length;
  if (width && rows.slice(1).every(row => RAILS_ONLY.test(row.slice(0, width)))) rows = rows.map(row => row.slice(width));
  return rows.join('\n');
}

export const referenceToken = (id: string) => `{{ref:${id}}}`;
/** How a cited excerpt appears in the prompt sent to the model. */
export const renderReference = (ascii: string, comment?: string) => '```text\n' + ascii.replace(/\s+$/, '') + '\n```' + (comment ? `\n${comment}` : '');

/** Selected examples in stable selection order; inserted only at {{references}}. */
export const renderReferences = (items: { name: string; ascii: string; comment?: string }[]) => items.map(item => `### ${item.name}\n${renderReference(item.ascii, item.comment)}`).join("\n\n");
