export interface ScrollPosition { top: number; left: number }

/** Optional host-owned scroll persistence. The viewer still owns native scrolling. */
export interface SourceScrollState {
  read(): ScrollPosition | undefined;
  connect(read: () => ScrollPosition | undefined): () => void;
  write(position: ScrollPosition): void;
}
