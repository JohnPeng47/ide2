import { useState, type ChangeEvent, type FormEvent } from "react";
import type { ArtifactImportInput, GenerationOutputKind, MappedArtifactBundle } from "../domain";

function artifactFromFile(fileName: string, contents: string): {
  name: string;
  ascii: string;
  artifactKind?: GenerationOutputKind;
  bundle?: MappedArtifactBundle;
} {
  const fallbackName = fileName.replace(/\.[^.]+$/, "").trim();
  try {
    const value = JSON.parse(contents) as Record<string, unknown>;
    if (value?.bundleVersion === 1
      && (value.artifactKind === "diagram" || value.artifactKind === "diagram-component")
      && value.artifact && typeof value.artifact === "object"
      && Array.isArray(value.codeEntities)) {
      const bundle = value as unknown as MappedArtifactBundle;
      return {
        name: bundle.artifact.name || fallbackName,
        ascii: bundle.artifact.ascii,
        artifactKind: bundle.artifactKind,
        bundle
      };
    }
    if (value && typeof value === "object" && typeof value.ascii === "string") {
      const artifactKind = value.artifactKind === "diagram-component"
        || Object.hasOwn(value, "derivedFromDiagramComponentIds")
        ? "diagram-component"
        : value.artifactKind === "diagram" ? "diagram" : undefined;
      return {
        name: typeof value.name === "string" && value.name.trim() ? value.name : fallbackName,
        ascii: value.ascii,
        artifactKind
      };
    }
  } catch {
    // Plain ASCII artifacts are expected to be non-JSON.
  }
  return { name: fallbackName, ascii: contents };
}

export function ImportArtifactDialog(props: {
  onClose: () => void;
  onImport: (input: ArtifactImportInput) => Promise<void>;
}) {
  const [artifactKind, setArtifactKind] = useState<GenerationOutputKind>("diagram");
  const [name, setName] = useState("");
  const [ascii, setAscii] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [bundle, setBundle] = useState<MappedArtifactBundle | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const imported = artifactFromFile(file.name, await file.text());
      setName(imported.name);
      setAscii(imported.ascii);
      if (imported.artifactKind) setArtifactKind(imported.artifactKind);
      setBundle(imported.bundle);
      setSourceName(file.name);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "artifact file could not be read");
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await props.onImport({ artifactKind, name, ascii, ...(bundle ? { bundle } : {}) });
      props.onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "artifact import failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="import-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) props.onClose();
      }}
    >
      <section
        className="import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-dialog-title"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) props.onClose();
        }}
      >
        <header>
          <div>
            <span className="eyebrow">GLOBAL IMPORT</span>
            <h2 id="import-dialog-title">Import an ASCII artifact</h2>
          </div>
          <button type="button" aria-label="Close import" disabled={busy} onClick={props.onClose}>[x]</button>
        </header>
        <form onSubmit={(event) => void submit(event)}>
          <div className="import-fields">
            <fieldset className="import-kind">
              <legend>ARTIFACT TYPE</legend>
              <button
                type="button"
                role="radio"
                aria-checked={artifactKind === "diagram"}
                className={artifactKind === "diagram" ? "is-active" : ""}
                disabled={busy}
                onClick={() => setArtifactKind("diagram")}
              >Diagram</button>
              <button
                type="button"
                role="radio"
                aria-checked={artifactKind === "diagram-component"}
                className={artifactKind === "diagram-component" ? "is-active" : ""}
                disabled={busy}
                onClick={() => setArtifactKind("diagram-component")}
              >DiagramComponent</button>
            </fieldset>
          </div>
          <label className="import-name">
            <span>NAME</span>
            <input
              autoFocus
              required
              maxLength={120}
              value={name}
              disabled={busy}
              placeholder="Pursuer state update"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="import-file">
            <span>LOAD FILE</span>
            <input type="file" accept=".txt,.asc,.ascii,.json,text/plain,application/json" disabled={busy} onChange={(event) => void loadFile(event)} />
            <small>{sourceName || "Plain ASCII or an artifact JSON file"}</small>
          </label>
          <label className="import-ascii">
            <span>7-BIT ASCII</span>
            <textarea
              required
              maxLength={20000}
              value={ascii}
              disabled={busy}
              spellCheck={false}
              placeholder={"+----------------------+\n| Diagram              |\n+----------------------+"}
              onChange={(event) => {
                setAscii(event.target.value);
                setBundle(undefined);
              }}
            />
          </label>
          {error ? <p className="inline-error" role="alert">{error}</p> : null}
          <footer>
            <span>{ascii.length.toLocaleString()} / 20,000 characters</span>
            <button type="button" className="button" disabled={busy} onClick={props.onClose}>cancel</button>
            <button type="submit" className="button button--primary" disabled={busy || !name.trim() || !ascii.trim()}>
              {busy ? "importing…" : `import ${artifactKind === "diagram" ? "Diagram" : "DiagramComponent"}`}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
