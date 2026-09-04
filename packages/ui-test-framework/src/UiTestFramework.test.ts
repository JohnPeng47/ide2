import { describe, expect, it } from "vitest";
import { normalizeStoredValues } from "./UiTestFramework";

const controls = {
  enabled: { type: "toggle", label: "Enabled", defaultValue: false },
  style: {
    type: "select",
    label: "Style",
    defaultValue: "underline",
    options: [
      { value: "underline", label: "Underline" },
      { value: "fill", label: "Fill" }
    ]
  },
  hue: { type: "range", label: "Hue", defaultValue: 190, min: 0, max: 360 },
  color: { type: "color", label: "Color", defaultValue: "#88c0d0" }
} as const;

describe("UI test framework values", () => {
  it("uses valid persisted values and ignores unknown keys", () => {
    expect(normalizeStoredValues(controls, {
      enabled: true,
      style: "fill",
      hue: 240,
      color: "#abcdef",
      removedControl: "stale"
    })).toEqual({ enabled: true, style: "fill", hue: 240, color: "#abcdef" });
  });

  it("falls back per control when persisted values no longer match the schema", () => {
    expect(normalizeStoredValues(controls, {
      enabled: "yes",
      style: "removed",
      hue: 999,
      color: "cyan"
    })).toEqual({ enabled: false, style: "underline", hue: 190, color: "#88c0d0" });
  });
});
