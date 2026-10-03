import { Fragment, createContext, useContext, useId, useLayoutEffect, type ReactNode } from 'react';
import type { MappingDocumentController } from '../../../../domain/mapping/workspace/mappingDocumentController';
import type { Editor } from 'tldraw';

/** Application features supply bodies; shapes render them in the editor's event
 * tree. React portals would route pointer events through the canvas overlay. */
export class ShapeSlots {
  private parts = new Map<string, Map<string, ReactNode>>();
  private bodies = new Map<string, ReactNode[]>();
  private listeners = new Map<string, Set<() => void>>();
  editor?: Editor;
  controller?: MappingDocumentController;
  get = (id: string) => this.bodies.get(id);
  subscribe = (id: string, listener: () => void) => {
    const listeners = this.listeners.get(id) ?? new Set();
    listeners.add(listener); this.listeners.set(id, listeners);
    return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(id); };
  };
  set(id: string, part: string, content: ReactNode) {
    const parts = this.parts.get(id) ?? new Map();
    if (content === null) parts.delete(part); else parts.set(part, content);
    if (parts.size) {
      this.parts.set(id, parts); this.bodies.set(id, [...parts].map(([key, content]) => <Fragment key={key}>{content}</Fragment>));
    } else { this.parts.delete(id); this.bodies.delete(id); }
    this.listeners.get(id)?.forEach(listener => listener());
  }
}
export const ShapeSlotsContext = createContext<ShapeSlots | null>(null);
export function MappingShapeContent({ id, children }: { id: string; children: ReactNode }) {
  const slots = useContext(ShapeSlotsContext), part = useId();
  useLayoutEffect(() => { slots?.set(id, part, children); }, [slots, id, part, children]);
  useLayoutEffect(() => () => slots?.set(id, part, null), [slots, id, part]);
  return slots ? null : children;
}
