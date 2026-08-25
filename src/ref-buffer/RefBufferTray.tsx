import { useMemo, useState } from "react";
import type { ReferenceIdentity } from "../domain";
import { referenceIdentityKey } from "../refBuffer";
import { resolveReferences, type ReferenceResolutionContext } from "../referenceResolver";
import { useRefBuffer } from "./RefBufferContext";
import { displayTextForReference, formatReferences } from "./refFormatters";
import {
  ClipboardSink,
  WindowReferenceSink,
  createReferenceEnvelope,
  type OutputSink,
  type ReferenceEnvelope
} from "./refOutputSinks";

const clipboardSink = new ClipboardSink();
const defaultInternalSink = new WindowReferenceSink();

export function RefBufferTray(props: {
  resolutionContext: ReferenceResolutionContext;
  projectId: string;
  diagramSetId: string;
  sourceArtifactId?: string;
  onInsertTokens: (tokens: string) => void;
  internalSink?: OutputSink<ReferenceEnvelope>;
  previewEntries?: readonly ReferenceIdentity[];
  showWhenEmpty?: boolean;
}) {
  const buffer = useRefBuffer();
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const resolution = useMemo(
    () => resolveReferences(buffer.entries, props.resolutionContext),
    [buffer.entries, props.resolutionContext]
  );
  const previewEntries = useMemo(() => {
    const committedKeys = new Set(buffer.entries.map(referenceIdentityKey));
    const seen = new Set<string>();
    return (props.previewEntries ?? []).filter((entry) => {
      const key = referenceIdentityKey(entry);
      if (committedKeys.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [buffer.entries, props.previewEntries]);
  const previewResolution = useMemo(
    () => resolveReferences([...previewEntries], props.resolutionContext),
    [previewEntries, props.resolutionContext]
  );
  if (buffer.entries.length === 0 && previewEntries.length === 0 && !props.showWhenEmpty) return null;

  const run = async (action: () => Promise<string>) => {
    setError("");
    try {
      setStatus(await action());
    } catch (caught) {
      setStatus("");
      setError(caught instanceof Error ? caught.message : "reference output failed");
    }
  };
  const outputDisabled = resolution.unresolved.length > 0 || resolution.resolved.length === 0;
  return (
    <section
      className="ref-buffer-tray"
      aria-label="Selected references"
      data-ref-buffer-count={buffer.entries.length}
      data-ref-buffer-preview-count={previewEntries.length}
    >
      <header>
        <strong>
          SELECTED REFS ({buffer.entries.length})
          {previewEntries.length > 0 ? ` · ${previewEntries.length} IN RECT` : ""}
        </strong>
        <div className="ref-buffer-actions">
          <button
            type="button"
            disabled={outputDisabled}
            onClick={() => void run(async () => {
              const text = formatReferences(resolution.resolved, "source-location");
              await clipboardSink.send(text);
              return `copied ${resolution.resolved.length} source ref${resolution.resolved.length === 1 ? "" : "s"}`;
            })}
          >copy paths</button>
          <button
            type="button"
            disabled={outputDisabled}
            onClick={() => void run(async () => {
              const tokens = formatReferences(resolution.resolved, "prompt-token");
              props.onInsertTokens(tokens);
              return "inserted prompt refs";
            })}
          >insert tokens</button>
          <button
            type="button"
            disabled={outputDisabled}
            onClick={() => void run(async () => {
              const envelope = createReferenceEnvelope({
                projectId: props.projectId,
                diagramSetId: props.diagramSetId,
                ...(props.sourceArtifactId ? { sourceArtifactId: props.sourceArtifactId } : {}),
                references: buffer.entries
              });
              await (props.internalSink ?? defaultInternalSink).send(envelope);
              return `sent ${buffer.entries.length} internal ref${buffer.entries.length === 1 ? "" : "s"}`;
            })}
          >send</button>
          <button type="button" onClick={buffer.clear}>clear</button>
        </div>
      </header>
      <div className="ref-buffer-items">
        {resolution.resolved.map((ref) => (
          <div
            className="ref-buffer-item"
            data-ref-kind={ref.kind}
            data-ref-target-id={ref.identity.targetId}
            data-source-range-index={ref.identity.sourceRangeIndex}
            key={referenceIdentityKey(ref.identity)}
          >
            <button
              type="button"
              aria-label={`Remove ${displayTextForReference(ref)}`}
              onClick={() => buffer.remove(ref.identity)}
            >×</button>
            <code title={formatReferences([ref], "prompt-token")}>{displayTextForReference(ref)}</code>
          </div>
        ))}
        {resolution.unresolved.map((ref) => (
          <div className="ref-buffer-item is-unresolved" key={referenceIdentityKey(ref)}>
            <button type="button" aria-label="Remove unavailable reference" onClick={() => buffer.remove(ref)}>×</button>
            <code>unavailable: {ref.kind}:{ref.targetId}</code>
          </div>
        ))}
        {previewResolution.resolved.map((ref) => (
          <div
            className="ref-buffer-item is-preview"
            data-ref-kind={ref.kind}
            data-ref-target-id={ref.identity.targetId}
            data-source-range-index={ref.identity.sourceRangeIndex}
            key={`preview:${referenceIdentityKey(ref.identity)}`}
          >
            <span aria-hidden="true">+</span>
            <code title={formatReferences([ref], "prompt-token")}>{displayTextForReference(ref)}</code>
          </div>
        ))}
        {previewResolution.unresolved.map((ref) => (
          <div className="ref-buffer-item is-preview is-unresolved" key={`preview:${referenceIdentityKey(ref)}`}>
            <span aria-hidden="true">+</span>
            <code>unavailable: {ref.kind}:{ref.targetId}</code>
          </div>
        ))}
        {buffer.entries.length === 0 && previewEntries.length === 0 ? (
          <p className="ref-buffer-empty">Drag across mapped elements to preview references here.</p>
        ) : null}
      </div>
      {status ? <p className="ref-buffer-status" role="status">{status}</p> : null}
      {error ? <p className="ref-buffer-error" role="alert">{error}</p> : null}
    </section>
  );
}
