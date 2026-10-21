/** Missing parents are allowed for partial record validation and detached imports. */
export function validateCanvasParents(documents: readonly { representationId: string; parentCanvasId?: string }[]) {
  const parents = new Map(documents.map(doc => [doc.representationId, doc.parentCanvasId]));
  for (const doc of documents) {
    const visited = new Set<string>();
    let id: string | undefined = doc.representationId;
    while (id !== undefined) {
      if (visited.has(id)) throw Error('Canvas parent relationships must not contain a cycle');
      visited.add(id); id = parents.get(id);
    }
  }
}
