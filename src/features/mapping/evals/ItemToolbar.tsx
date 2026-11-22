import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * The navigation bar exposes one slot. Views inside an item place their controls there instead of in
 * their own rows, so everything above the evidence fits on a single line. Without a slot (no
 * experiment navigation), views keep their standalone toolbars.
 */
export const ItemToolbarContext = createContext<HTMLElement | null>(null);
export const useItemToolbar = () => useContext(ItemToolbarContext);
/** `group` fixes the order of contributions regardless of mount order. */
export function ItemToolbarPortal({ group, children }: { group: 'judgement' | 'report' | 'tree'; children: ReactNode }) {
  const slot = useContext(ItemToolbarContext);
  return slot ? createPortal(<span className={`item-toolbar-group is-${group}`}>{children}</span>, slot) : null;
}
