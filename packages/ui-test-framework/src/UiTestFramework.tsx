import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";
import "./styles.css";

type ToggleControl = {
  type: "toggle";
  label: string;
  description?: string;
  defaultValue: boolean;
};

type SelectControl<Value extends string = string> = {
  type: "select";
  label: string;
  description?: string;
  defaultValue: Value;
  options: readonly { value: Value; label: string }[];
};

type RangeControl = {
  type: "range";
  label: string;
  description?: string;
  defaultValue: number;
  min: number;
  max: number;
  step?: number;
};

type ColorControl = {
  type: "color";
  label: string;
  description?: string;
  defaultValue: string;
};

type UiTestControl = ToggleControl | SelectControl | RangeControl | ColorControl;
type UiTestControls = Record<string, UiTestControl>;
type ValueFor<Control extends UiTestControl> = Control extends ToggleControl
  ? boolean
  : Control extends SelectControl<infer Value>
    ? Value
    : Control extends RangeControl
      ? number
      : string;
type UiTestValues<Controls extends UiTestControls> = {
  [Key in keyof Controls]: ValueFor<Controls[Key]>;
};

function defaultsFor<Controls extends UiTestControls>(controls: Controls): UiTestValues<Controls> {
  return Object.fromEntries(
    Object.entries(controls).map(([id, control]) => [id, control.defaultValue])
  ) as UiTestValues<Controls>;
}

function validValue(control: UiTestControl, value: unknown): boolean {
  if (control.type === "toggle") return typeof value === "boolean";
  if (control.type === "select") {
    return typeof value === "string" && control.options.some((option) => option.value === value);
  }
  if (control.type === "range") {
    return typeof value === "number"
      && Number.isFinite(value)
      && value >= control.min
      && value <= control.max;
  }
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

export function normalizeStoredValues<Controls extends UiTestControls>(
  controls: Controls,
  stored: unknown
): UiTestValues<Controls> {
  const defaults = defaultsFor(controls);
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return defaults;
  const record = stored as Record<string, unknown>;
  return Object.fromEntries(Object.entries(controls).map(([id, control]) => [
    id,
    validValue(control, record[id]) ? record[id] : control.defaultValue
  ])) as UiTestValues<Controls>;
}

function readStoredValues<Controls extends UiTestControls>(
  controls: Controls,
  storageKey: string
): UiTestValues<Controls> {
  if (typeof window === "undefined") return defaultsFor(controls);
  try {
    const stored = window.localStorage.getItem(storageKey);
    return normalizeStoredValues(controls, stored ? JSON.parse(stored) : undefined);
  } catch {
    return defaultsFor(controls);
  }
}

function controlId(panelId: string, id: string): string {
  return `${panelId}-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

export function UiTestFramework<const Controls extends UiTestControls>(props: {
  id: string;
  controls: Controls;
  children: (values: UiTestValues<Controls>) => ReactNode;
  title?: string;
  triggerLabel?: string;
  menuContent?: ReactNode;
  persist?: boolean;
}) {
  const reactId = useId().replaceAll(":", "");
  const panelId = `ui-test-framework-${reactId}`;
  const storageKey = `ui-test-framework:${props.id}`;
  const persist = props.persist ?? true;
  const defaultValues = useMemo(() => defaultsFor(props.controls), [props.controls]);
  const [values, setValues] = useState<UiTestValues<Controls>>(() => (
    persist ? readStoredValues(props.controls, storageKey) : defaultValues
  ));
  const [open, setOpen] = useState(false);
  const dialRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setValues((current) => normalizeStoredValues(props.controls, current));
  }, [props.controls]);

  useEffect(() => {
    if (!persist || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(values));
    } catch {
      // The tool remains usable when storage is unavailable or full.
    }
  }, [persist, storageKey, values]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      requestAnimationFrame(() => dialRef.current?.focus());
    };
    const onPointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !panelRef.current?.contains(target) && !dialRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const update = (id: keyof Controls, value: boolean | string | number) => {
    setValues((current) => ({ ...current, [id]: value }));
  };

  const controls = typeof document === "undefined" ? null : createPortal(
    <div className="ui-test-framework" data-ui-test-framework={props.id}>
      {open ? (
        <section
          ref={panelRef}
          id={panelId}
          className="ui-test-framework__panel"
          aria-label={props.title ?? "UI testing controls"}
        >
          <header>
            <div>
              <span>{props.menuContent ? "WORKSPACE" : "DEV TOOL"}</span>
              <strong>{props.title ?? "UI variants"}</strong>
            </div>
            <button
              type="button"
              onClick={() => setValues(defaultValues)}
              disabled={Object.entries(defaultValues).every(([id, value]) => values[id] === value)}
            >reset all</button>
          </header>
          {props.menuContent}
          <div className="ui-test-framework__controls">
            {Object.entries(props.controls).map(([id, control]) => {
              const inputId = controlId(panelId, id);
              const descriptionId = control.description ? `${inputId}-description` : undefined;
              const value = values[id];
              return (
                <div className="ui-test-framework__control" data-ui-test-control={id} key={id}>
                  <label htmlFor={inputId}>
                    <span>{control.label}</span>
                    {control.type === "range" ? <output>{String(value)}</output> : null}
                  </label>
                  {control.description ? <small id={descriptionId}>{control.description}</small> : null}
                  {control.type === "toggle" ? (
                    <input
                      id={inputId}
                      type="checkbox"
                      checked={Boolean(value)}
                      aria-describedby={descriptionId}
                      onChange={(event) => update(id, event.target.checked)}
                    />
                  ) : control.type === "select" ? (
                    <select
                      id={inputId}
                      value={String(value)}
                      aria-describedby={descriptionId}
                      onChange={(event) => update(id, event.target.value)}
                    >
                      {control.options.map((option) => (
                        <option value={option.value} key={option.value}>{option.label}</option>
                      ))}
                    </select>
                  ) : control.type === "range" ? (
                    <input
                      id={inputId}
                      type="range"
                      min={control.min}
                      max={control.max}
                      step={control.step ?? 1}
                      value={Number(value)}
                      aria-describedby={descriptionId}
                      onChange={(event) => update(id, Number(event.target.value))}
                    />
                  ) : (
                    <input
                      id={inputId}
                      type="color"
                      value={String(value)}
                      aria-describedby={descriptionId}
                      onChange={(event) => update(id, event.target.value)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
      <button
        ref={dialRef}
        type="button"
        className="ui-test-framework__dial"
        data-ui-test-dial="true"
        aria-label={props.triggerLabel ?? "Toggle UI testing controls"}
        aria-controls={panelId}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true">{props.triggerLabel ?? "UI"}</span>
      </button>
    </div>,
    document.body
  );

  return <>{props.children(values)}{controls}</>;
}
