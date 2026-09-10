import type { ReactNode } from "react";
export function FloatingPane(props: { children: ReactNode }) {
  return <aside className="mapping-floating-pane" aria-label="Project diagram explorer" data-diagram-canvas-static-ui>
    {props.children}
  </aside>;
}
