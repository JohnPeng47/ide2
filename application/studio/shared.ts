import { createHash } from "node:crypto";
import {
  type AgentRunRecord,
  type GenerationOutputKind,
  type WorkspaceSnapshot
} from "../../domain/core/records/domain";

export const MAX_GENERATION_COUNT = 12;

export const MAX_ATTEMPTS = 3;

export const MARKER_CHARACTERS = ["`", "~", "^", "{", "}"] as const;

export interface ServiceEvent {
  type: "progress" | "workspace";
  message: string;
  workspace?: WorkspaceSnapshot;
  artifactKind?: GenerationOutputKind;
  artifactId?: string;
  status?: AgentRunRecord["status"];
}

export function timestamp(): string {
  return new Date().toISOString();
}

export function assertMaterializedKey(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(value)) {
    throw new Error(`${label} must be a lowercase letter/digit key with optional hyphens`);
  }
}

export function stableProjectId(prefix: string, ...parts: string[]): string {
  const digest = createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 32);
  return `${prefix}-${digest}`;
}
