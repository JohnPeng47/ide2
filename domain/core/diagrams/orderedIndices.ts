/** Indices in one longest increasing subsequence; insertions do not imply moves. */
export function orderedIndices(values: number[]): Set<number> {
  const tails: number[] = [], previous: number[] = [];
  values.forEach((value, index) => {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (values[tails[mid]] < value) lo = mid + 1; else hi = mid; }
    previous[index] = lo ? tails[lo - 1] : -1; tails[lo] = index;
  });
  const result = new Set<number>();
  for (let index = tails.at(-1) ?? -1; index >= 0; index = previous[index]) result.add(index);
  return result;
}
