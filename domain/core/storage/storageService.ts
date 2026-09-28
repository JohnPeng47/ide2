/** Values are owned immutable snapshots. Submission never encodes or traverses values. */
export type StorageChange = { key: string; value: unknown } | { key: string; delete: true };
export interface StorageStatus { pending: boolean; writing: boolean; error?: string }
export interface StorageService {
  get<T>(key: string): T | undefined;
  store(key: string, value: unknown): void;
  remove(key: string): void;
  batch(changes: readonly StorageChange[]): void;
  /** Commit all submissions preceding this call. Reject on failed/conflicting writes. */
  flush(): Promise<void>;
  readonly status: StorageStatus;
  subscribe(listener: () => void): () => void;
}
