import { focusIdentityKey, type CallGraphFocusNode, type CodeEntityFocusIdentity } from "../../../domain/core/source/callGraphFocus";
import { qualifiedCodeEntityPromptAlias, type CodeEntityRecord } from "../../../domain/core/records/domain";

interface MutableCallGraphNode extends CallGraphFocusNode {
  children: MutableCallGraphNode[];
}

interface ParsedLine {
  branchColumn?: number;
  label: string;
}

const BRANCH = /([+`\\|])--(?:\[([^\]]+)\]--)?(?:>|(?=\s))\s*(.*)$/;
const ENTITY_ANNOTATION = /\[(entity-[a-z0-9][a-z0-9-]*)\]/g;

function parseLine(line: string): ParsedLine {
  const branch = BRANCH.exec(line);
  if (branch) {
    const condition = branch[2] ? `[${branch[2]}] ` : "";
    return {
      branchColumn: branch.index,
      label: `${condition}${branch[3]}`.trim()
    };
  }
  const contentColumn = line.search(/[a-z0-9_[({]/i);
  return { label: contentColumn < 0 ? line.trim() : line.slice(contentColumn).trim() };
}

function isConnectorOnly(label: string): boolean {
  return Boolean(label) && !/[a-z0-9_[\](){}]/i.test(label);
}

function identityFor(entity: CodeEntityRecord): CodeEntityFocusIdentity {
  if (!entity.origin) throw new Error(`CodeEntity ${entity.id} is missing provenance`);
  return { kind: "code-entity", targetId: entity.id, origin: entity.origin };
}

function buildAnnotationIndex(
  entities: readonly CodeEntityRecord[]
): Map<string, readonly CodeEntityFocusIdentity[]> {
  const aliases = new Map<string, CodeEntityFocusIdentity[]>();
  for (const entity of entities) {
    const identity = identityFor(entity);
    for (const token of new Set([
      entity.id,
      `entity-${entity.handle}`,
      qualifiedCodeEntityPromptAlias(entity)
    ])) {
      const matches = aliases.get(token) ?? [];
      matches.push(identity);
      aliases.set(token, matches);
    }
  }
  return aliases;
}

function resolveAnnotation(
  token: string,
  aliases: ReadonlyMap<string, readonly CodeEntityFocusIdentity[]>
): CodeEntityFocusIdentity {
  const matches = aliases.get(token) ?? [];
  if (matches.length === 0) {
    throw new Error(`call graph annotation references undeclared CodeEntity: ${token}`);
  }
  const distinct = new Map(matches.map((identity) => [focusIdentityKey(identity), identity]));
  if (distinct.size !== 1) {
    throw new Error(`call graph annotation is ambiguous: ${token}`);
  }
  return [...distinct.values()][0];
}

function cloneNode(node: CallGraphFocusNode): CallGraphFocusNode {
  return { ...node, children: node.children.map(cloneNode) };
}

/**
 * Parse the persisted indentation-based ASCII call graph. Entity annotations
 * belong to their immediately preceding semantic node and never become rows.
 */
export function parseCallGraphTree(
  ascii: string,
  declaredEntities: readonly CodeEntityRecord[]
): CallGraphFocusNode[] {
  const aliases = buildAnnotationIndex(declaredEntities);
  const roots: MutableCallGraphNode[] = [];
  const ancestors: Array<{ branchColumn: number; node: MutableCallGraphNode }> = [];
  let previousNode: MutableCallGraphNode | undefined;

  for (const [index, rawLine] of ascii.replace(/\r\n?/g, "\n").split("\n").entries()) {
    const parsed = parseLine(rawLine);
    if (!parsed.label || isConnectorOnly(parsed.label)) continue;

    const annotationTokens = [...parsed.label.matchAll(ENTITY_ANNOTATION)].map((match) => match[1]);
    const label = parsed.label.replace(ENTITY_ANNOTATION, "").replace(/\s{2,}/g, " ").trim();
    if (annotationTokens.length > 1) {
      throw new Error(`call graph line ${index + 1} has multiple CodeEntity annotations`);
    }
    const annotation = annotationTokens[0]
      ? resolveAnnotation(annotationTokens[0], aliases)
      : undefined;

    if (!label && annotation) {
      if (!previousNode) {
        throw new Error(`call graph annotation on line ${index + 1} has no semantic node`);
      }
      if (previousNode.codeEntity
        && focusIdentityKey(previousNode.codeEntity) !== focusIdentityKey(annotation)) {
        throw new Error(`call graph node on line ${index + 1} has conflicting annotations`);
      }
      previousNode.codeEntity = annotation;
      continue;
    }

    const node: MutableCallGraphNode = {
      id: `call-graph-line-${index + 1}`,
      label,
      ...(annotation ? { codeEntity: annotation } : {}),
      children: []
    };
    if (parsed.branchColumn === undefined) {
      roots.push(node);
      ancestors.length = 0;
      ancestors.push({ branchColumn: -1, node });
    } else {
      while (ancestors.at(-1) && ancestors.at(-1)!.branchColumn >= parsed.branchColumn) {
        ancestors.pop();
      }
      const parent = ancestors.at(-1)?.node;
      if (!parent) {
        throw new Error(`call graph line ${index + 1} has no semantic parent`);
      }
      parent.children.push(node);
      ancestors.push({ branchColumn: parsed.branchColumn, node });
    }
    previousNode = node;
  }
  return roots;
}

export function filterCallGraphTree(
  roots: readonly CallGraphFocusNode[],
  selected: ReadonlySet<string>
): CallGraphFocusNode[] {
  const filterNode = (node: CallGraphFocusNode): CallGraphFocusNode | null => {
    const matches = node.codeEntity !== undefined && selected.has(focusIdentityKey(node.codeEntity));
    if (matches) return cloneNode(node);
    const children = node.children
      .map(filterNode)
      .filter((child): child is CallGraphFocusNode => child !== null);
    return children.length > 0 ? { ...node, children } : null;
  };
  return roots.map(filterNode).filter((node): node is CallGraphFocusNode => node !== null);
}
