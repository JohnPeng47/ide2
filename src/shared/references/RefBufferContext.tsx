import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type ReactNode
} from "react";
import type { ReferenceIdentity } from "../../../domain/core/records/domain";
import {
  EMPTY_REF_BUFFER,
  reduceRefBuffer,
  referenceIdentityKey,
  type BufferedDiagramSelection,
  type BufferedDiagramSelectionInput
} from "../../../domain/core/references/refBuffer";

export interface RefBufferApi {
  entries: ReferenceIdentity[];
  diagramSelections: BufferedDiagramSelection[];
  setScope(scopeKey: string | null): void;
  add(refs: ReferenceIdentity[], diagramSelection?: BufferedDiagramSelectionInput): void;
  remove(ref: ReferenceIdentity): void;
  clear(): void;
  replace(refs: ReferenceIdentity[]): void;
  contains(ref: ReferenceIdentity): boolean;
}

const RefBufferContext = createContext<RefBufferApi | null>(null);

export function RefBufferProvider(props: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reduceRefBuffer, EMPTY_REF_BUFFER);
  const setScope = useCallback((scopeKey: string | null) => dispatch({ type: "scope", scopeKey }), []);
  const add = useCallback((refs: ReferenceIdentity[], diagramSelection?: BufferedDiagramSelectionInput) => (
    dispatch({ type: "add", refs, diagramSelection })
  ), []);
  const remove = useCallback((ref: ReferenceIdentity) => dispatch({ type: "remove", ref }), []);
  const clear = useCallback(() => dispatch({ type: "clear" }), []);
  const replace = useCallback((refs: ReferenceIdentity[]) => dispatch({ type: "replace", refs }), []);
  const keys = useMemo(() => new Set(state.entries.map(referenceIdentityKey)), [state.entries]);
  const contains = useCallback((ref: ReferenceIdentity) => keys.has(referenceIdentityKey(ref)), [keys]);
  const value = useMemo<RefBufferApi>(() => ({
    entries: state.entries,
    diagramSelections: state.diagramSelections,
    setScope,
    add,
    remove,
    clear,
    replace,
    contains
  }), [add, clear, contains, remove, replace, setScope, state.diagramSelections, state.entries]);
  return <RefBufferContext.Provider value={value}>{props.children}</RefBufferContext.Provider>;
}

export function useRefBuffer(): RefBufferApi {
  const value = useContext(RefBufferContext);
  if (!value) throw new Error("useRefBuffer must be used within RefBufferProvider");
  return value;
}
