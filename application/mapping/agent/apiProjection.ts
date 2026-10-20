import type { DiagramMigration } from '../../../domain/mapping/changes/diagramMigration';
import { randomBytes } from 'node:crypto';
import type { DiagramContent } from '../../../domain/core/diagrams/diagramContent';
import { diagramContentNodes } from '../../../domain/core/diagrams/diagramContentNodes';
import type { DiagramAnchor, DiagramConnection } from '../../../domain/core/diagrams/diagramConnection';
import type { DiagramJump } from '../../../domain/core/diagrams/diagramJump';
import { canvasApiFormatVersion, type ApiDiagramContent, type ApiDisplayNode } from '../../../domain/mapping/agent/apiRepresentation';
import type { CanvasDisplayNode } from '../../../domain/mapping/workspace/canvasDisplayNode';

/** One instance per backend, shared by tools and live connections. Never evict/reassign handles. */
export class CanvasApiProjection {
  private readonly generation = randomBytes(6).toString('base64url');
  private readonly scopes = new Map<string, { name: string; count: number }>();
  private readonly shortIds = new Map<string, string>();
  private readonly fullIds = new Map<string, string>();
  constructor(private readonly maxAnchors = 1_000_000) {}

  anchorId(id: string): string {
    const existing = this.shortIds.get(id);
    if (existing) return existing;
    if (this.shortIds.size >= this.maxAnchors) throw Error('ANCHOR_CAPACITY: restart backend and reread anchors');
    // Both tree and free-form anchor IDs include the complete revision/hash prefix.
    // Opaque legacy/stale IDs get their own scope; never guess which current node they mean.
    const key = /^(.*:[a-f0-9]{64}):/.exec(id)?.[1] ?? id;
    let scope = this.scopes.get(key);
    if (!scope) {
      scope = { name: `@${this.generation}.${(this.scopes.size + 1).toString(36)}`, count: 0 };
      this.scopes.set(key, scope);
    }
    const handle = `${scope.name}:${(++scope.count).toString(36)}`;
    this.shortIds.set(id, handle); this.fullIds.set(handle, id);
    return handle;
  }

  isAnchorHandle(id: string): boolean { return /^@[A-Za-z0-9_-]{8}\.[0-9a-z]+:[0-9a-z]+$/.test(id); }

  resolveAnchorId(id: string): string {
    const full = this.fullIds.get(id);
    if (full) return full;
    if (this.isAnchorHandle(id)) throw Error('STALE_CONTENT_NODE: unknown anchor handle; reread the diagram');
    return id; // Existing full-ID callers remain valid.
  }

  content(content: DiagramContent): ApiDiagramContent {
    const nodes = diagramContentNodes(content);
    return { ...content, structure: { ...content.structure,
      ...(content.structure.kind === 'tree' ? { rootIds: content.structure.rootIds.map(id => this.anchorId(id)) } : {}),
      nodes: Object.fromEntries(nodes.map(node => {
        const id = this.anchorId(node.id);
        return [id, { ...node, id, ...(node.parentId ? { parentId: this.anchorId(node.parentId) } : {}),
          childIds: node.childIds.map(child => this.anchorId(child)) }];
      }))
    } };
  }

  node(node: CanvasDisplayNode): ApiDisplayNode {
    if (node.layout !== 'grid') return { ...node, apiFormatVersion: canvasApiFormatVersion };
    const { contentNodes: _index, content, diagram, ...rest } = node;
    const highlights = diagram?.highlights?.map(item => ({ ...item, ...(item.contentNodeId ? { contentNodeId: this.anchorId(item.contentNodeId) } : {}) }));
    const metadata = diagram && (({ content: _content, ...value }) => value)(diagram);
    return { ...rest, apiFormatVersion: canvasApiFormatVersion,
      collapsible: { ...node.collapsible, subtrees: node.collapsible.subtrees.map(item => ({ ...item, contentNodeId: this.anchorId(item.contentNodeId) })) },
      ...(content ? { content: this.content(content) } : {}),
      ...(metadata ? { diagram: { ...metadata, ...(highlights ? { highlights } : {}), ...(metadata.jumps ? { jumps: metadata.jumps.map(jump => this.jump(jump)) } : {}) } } : {}) };
  }
  nodes(nodes: readonly CanvasDisplayNode[]) { return nodes.map(node => this.node(node)); }
  result<T extends { nodes: CanvasDisplayNode[] }>(result: T): Omit<T, 'nodes'> & {
    apiFormatVersion: typeof canvasApiFormatVersion; nodes: ApiDisplayNode[];
  } {
    return { ...result, apiFormatVersion: canvasApiFormatVersion, nodes: this.nodes(result.nodes) };
  }
  anchor<T extends DiagramAnchor>(anchor: T): T {
    return anchor.kind === 'content-node' ? { ...anchor, contentNodeId: this.anchorId(anchor.contentNodeId) } : { ...anchor };
  }
  edge(edge: DiagramConnection): DiagramConnection {
    return { ...edge, source: this.anchor(edge.source), target: this.anchor(edge.target) };
  }
  resolveEdge<T extends Omit<DiagramConnection, 'id'>>(edge: T): T {
    return { ...edge, source: { ...edge.source, contentNodeId: this.resolveAnchorId(edge.source.contentNodeId) },
      target: edge.target.kind === 'content-node' ? { ...edge.target, contentNodeId: this.resolveAnchorId(edge.target.contentNodeId) } : edge.target };
  }
  migrations(migrations: readonly DiagramMigration[] = [], resolve = false): DiagramMigration[] {
    const map = (id: string) => resolve ? this.resolveAnchorId(id) : this.anchorId(id);
    return migrations.map(migration => ({ ...migration,
      source: { ...migration.source, contentNodeId: map(migration.source.contentNodeId) },
      destination: { ...migration.destination, contentNodeId: map(migration.destination.contentNodeId) } }));
  }
  jump(jump: DiagramJump): DiagramJump {
    return this.mapJump(jump, id => this.anchorId(id));
  }
  resolveJump(jump: DiagramJump): DiagramJump {
    return this.mapJump(jump, id => this.resolveAnchorId(id));
  }
  private mapJump(jump: DiagramJump, map: (id: string) => string): DiagramJump {
    return { ...jump, source: { ...jump.source, ...(jump.source.contentNodeId ? { contentNodeId: map(jump.source.contentNodeId) } : {}) },
      target: { ...jump.target, ...(jump.target.contentNodeId ? { contentNodeId: map(jump.target.contentNodeId) } : {}) } };
  }
}
