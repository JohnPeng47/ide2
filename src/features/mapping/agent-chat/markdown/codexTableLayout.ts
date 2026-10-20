// Copyright 2025 OpenAI. SPDX-License-Identifier: Apache-2.0
// Modified: TypeScript adaptation for T3 Code, ported to WindowPanel; see ../CODEX-LICENSE.
// Browser adaptation of codex-rs/tui/src/markdown_render.rs and table_key_value.rs.
// Widths are measured in monospace cells; padding and gaps consume four cells per column.
type ColumnKind = "token" | "narrative" | "compact";
const length = (text: string) => Array.from(text).length;
const words = (text: string) => text.split(/\s+/).filter(Boolean);
const longestToken = (text: string) => Math.max(0, ...words(text).map(length));
const lineWidth = (text: string) => Math.max(0, ...text.split("\n").map(length));

function wrappedHeight(text: string, width: number): number {
  return text.split("\n").reduce((height, line) => {
    let used = 0;
    let lines = 1;
    for (const word of words(line)) {
      const size = length(word);
      if (used && used + 1 + size > width) {
        lines++;
        used = 0;
      } else if (used) used++;
      lines += Math.floor((size - 1) / width);
      used += ((size - 1) % width) + 1;
    }
    return height + lines;
  }, 0);
}

export function codexTableLayout(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  columns: number,
) {
  const metrics = headers.map((header, i) => {
    const cells = rows.map((row) => row[i] ?? "").filter((cell) => cell.trim());
    const tokens = cells.flatMap(words);
    const longTokens = tokens.filter((token) => length(token) >= 20).length;
    const count = Math.max(1, cells.length);
    const kind: ColumnKind =
      longTokens > 0 && longTokens * 2 >= tokens.length
        ? "token"
        : tokens.length / count >= 4 ||
            cells.reduce((sum, cell) => sum + length(cell), 0) / count >= 28
          ? "narrative"
          : "compact";
    const max = Math.max(3, lineWidth(header), ...cells.map(lineWidth));
    const floor = Math.min(
      max,
      Math.max(
        3,
        kind === "compact"
          ? Math.max(longestToken(header), Math.min(16, Math.max(0, ...cells.map(longestToken))))
          : 16,
      ),
    );
    return { kind, max, floor, priority: kind === "token" ? 0 : kind === "narrative" ? 1 : 2 };
  });
  const budget = Math.max(0, Math.floor(columns) - headers.length * 4 + 2);
  const widths = metrics.map((metric) => metric.max);
  const floors = metrics.map((metric) => metric.floor);
  const shrink = (values: number[], minimums: number[]) => {
    let excess = values.reduce((sum, value) => sum + value, 0) - budget;
    while (excess > 0) {
      let chosen = -1;
      for (let i = 0; i < values.length; i++) {
        if (values[i]! <= minimums[i]!) continue;
        if (
          chosen < 0 ||
          metrics[i]!.priority < metrics[chosen]!.priority ||
          (metrics[i]!.priority === metrics[chosen]!.priority &&
            values[i]! - minimums[i]! > values[chosen]! - minimums[chosen]!)
        )
          chosen = i;
      }
      if (chosen < 0) break;
      values[chosen]!--;
      excess--;
    }
  };
  shrink(
    floors,
    floors.map(() => 3),
  );
  shrink(widths, floors);
  let affected = 0;
  for (const row of rows) {
    const fragmented = metrics.some(
      (metric, i) =>
        (metric.kind === "compact" || (metric.kind === "token" && widths[i]! < 12)) &&
        longestToken(row[i] ?? "") > widths[i]!,
    );
    const expansive = metrics.flatMap((metric, i) =>
      metric.kind === "compact"
        ? []
        : [
            {
              kind: metric.kind,
              width: widths[i]!,
              height: wrappedHeight(row[i] ?? "", widths[i]!),
            },
          ],
    );
    if (
      fragmented ||
      expansive.filter((cell) => cell.height >= 4).length >= 2 ||
      expansive.some((cell) => cell.kind === "narrative" && cell.width < 12 && cell.height >= 7)
    )
      affected++;
  }
  const records =
    rows.length > 0 &&
    (budget < headers.length * 3 ||
      affected >= (rows.length === 1 ? 1 : Math.max(2, Math.ceil(rows.length / 3))));
  const labelWidth = Math.max(0, ...headers.map(lineWidth));
  const minValueWidth = metrics.some((metric) => metric.kind !== "compact") ? 24 : 12;
  return { widths, records, labelWidth, stacked: columns < labelWidth + 3 + minValueWidth };
}
