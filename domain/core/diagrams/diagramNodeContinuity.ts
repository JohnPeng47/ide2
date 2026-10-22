/** Generator-only annotations. Persisted ASCII never contains identity markers. */
export function stripNodeContinuity(ascii: string, nodeRefs: Readonly<Record<string, string>>) {
  const known = new Set(Object.values(nodeRefs)), correspondence: Record<string, number> = {};
  const lines = ascii.split('\n').map((line, index) => {
    if (!line.includes('[[keep:')) return line;
    const match = /\s*\[\[keep:([^\]\s]+)\]\]\s*$/.exec(line);
    if (!match || line.slice(0, match.index).includes('[[keep:')) throw Error('CONTINUITY: use one identity suffix per node line');
    const id = match[1];
    if (!known.has(id)) throw Error(`CONTINUITY: unknown logical node ${id}`);
    if (Object.hasOwn(correspondence, id)) throw Error(`CONTINUITY: duplicate logical node ${id}`);
    correspondence[id] = index + 1;
    return line.slice(0, match.index);
  });
  return { ascii: lines.join('\n'), nodeCorrespondence: correspondence };
}
