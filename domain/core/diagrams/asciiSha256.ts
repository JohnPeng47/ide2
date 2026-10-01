import { sha256 } from '../sha256';

/** Artifact identity deliberately remains limited to 7-bit ASCII. */
export function asciiSha256(value: string): string {
  if (!/^[\x00-\x7f]*$/.test(value)) throw new Error("artifact revision input must be 7-bit ASCII");
  return sha256(value);
}
