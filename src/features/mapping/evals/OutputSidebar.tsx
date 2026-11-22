import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Output controls stay with their owning preview but render in the explorer when available. */
export const OutputSidebarContext = createContext<HTMLElement | null>(null);

export function OutputSidebar({ children }: { children: ReactNode }) {
  const slot = useContext(OutputSidebarContext);
  return slot ? createPortal(children, slot) : <>{children}</>;
}
