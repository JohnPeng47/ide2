// Adapted from T3 Code CodexMarkdownPresentation.tsx; see ../T3CODE-LICENSE.
import {
  Children,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";
import { codexTableLayout } from "./codexTableLayout";

import { CopyButton } from "./CopyButton";


type Cell = ReactElement<ComponentProps<"td">>;
function elements(children: ReactNode) {
  return Children.toArray(children).filter(
    (child): child is ReactElement<{ children?: ReactNode }> => isValidElement(child),
  );
}
function plainText(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(plainText).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  return elements(node)
    .map((element) => (element.type === "br" ? "\n" : plainText(element.props.children)))
    .join("");
}

export function CodexMarkdownTable({ children, ...props }: ComponentProps<"table">) {

  const container = useRef<HTMLDivElement>(null);
  const table = useRef<HTMLTableElement>(null);
  const ruler = useRef<HTMLSpanElement>(null);
  const [columns, setColumns] = useState(100);
  const rows = useMemo(
    () =>
      elements(children).flatMap((section) =>
        elements(section.props.children).map((row) => ({
          key: row.key,
          cells: elements(row.props.children) as Cell[],
        })),
      ),
    [children],
  );
  const header = rows[0]?.cells ?? [];
  const body = rows.slice(1);
  const layout = useMemo(() => codexTableLayout(
    header.map(plainText),
    body.map((row) => row.cells.map(plainText)),
    columns,
  ), [rows, columns]);

  useEffect(() => {
    const target = container.current;
    const measure = ruler.current;
    if (!target || !measure || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const cellWidth = measure.getBoundingClientRect().width / 10;
      if (cellWidth > 0)
        setColumns(Math.max(1, Math.floor(target.getBoundingClientRect().width / cellWidth)));
    });
    observer.observe(target);
    observer.observe(measure);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={container}
      className="chat-markdown-table-container codex-table"
      data-layout={layout.records ? "records" : "grid"}
      data-stacked={layout.stacked}
    >
      <span ref={ruler} className="codex-cell-ruler" aria-hidden="true">
        0000000000
      </span>
      <table
        {...props}
        ref={table}
        role="table"
        style={{
          ...props.style,
          ...(!layout.records
            ? { width: `${layout.widths.reduce((sum, width) => sum + width + 4, -2)}ch` }
            : {}),
        }}
      >
        {!layout.records && (
          <colgroup>
            {layout.widths.map((width, i) => (
              <col
                key={header[i]?.key}
                style={{ width: `${width + (i === layout.widths.length - 1 ? 2 : 4)}ch` }}
              />
            ))}
          </colgroup>
        )}
        <thead role="rowgroup">
          <tr role="row">
            {header.map((cell) => (
              <th {...cell.props} key={cell.key} scope="col" role="columnheader" />
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup">
          {body.map((row) => (
            <tr key={row.key} role="row">
              {header.map((label, i) => (
                <td
                  {...row.cells[i]?.props}
                  key={label.key}
                  role="cell"
                  style={{
                    ...row.cells[i]?.props.style,
                    ...(layout.records
                      ? {
                          textAlign: "left",
                          gridTemplateColumns: layout.stacked
                            ? "1fr"
                            : `${layout.labelWidth}ch minmax(0, 1fr)`,
                        }
                      : {}),
                  }}
                >
                  {layout.records && (
                    <span className="codex-table-label" data-markdown-copy="" aria-hidden="true">
                      {label.props.children}
                    </span>
                  )}
                  <span className="codex-table-value">{row.cells[i]?.props.children}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="codex-table-actions">
        <CopyButton label="Copy table" text={() => {
          const escape = (value: string) => value.replaceAll("|", "\\|").replaceAll("\n", "<br>");
          const row = (cells: Cell[]) => `| ${cells.map(cell => escape(plainText(cell.props.children))).join(" | ")} |`;
          return [row(header), `| ${header.map(() => "---").join(" | ")} |`, ...body.map(entry => row(entry.cells))].join("\n");
        }} />
      </div>
    </div>
  );
}
