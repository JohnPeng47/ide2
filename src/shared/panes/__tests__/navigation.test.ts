import {
  describe,
  expect,
  it,
  vi
} from "vitest";
import { PaneApi } from "../api";
import { addPane, createPaneLayout } from "../model";
import { PaneNavigationApi, type PaneJumpDestination } from "../navigation";

function setup(historyLimit = 3) {
  const primary = createPaneLayout({ id: "primary", tabs: [{ id: "diagram", label: "Diagram" }] });
  const state = addPane(primary, {
    id: "context",
    tabs: [
      { id: "entities", label: "Entities" },
      { id: "details", label: "Details" }
    ]
  }, "primary");
  const panes = new PaneApi(state);
  const scheduled: Array<() => void> = [];
  const navigation = new PaneNavigationApi(panes, historyLimit, (callback) => scheduled.push(callback));
  return { panes, navigation, flush: () => scheduled.splice(0).forEach((callback) => callback()) };
}

function destination(key: string): PaneJumpDestination<{ line: number }> {
  return {
    key,
    kind: "markdown-line",
    paneId: "context",
    tabId: "details",
    label: key,
    detail: "README.md",
    payload: { line: Number(key.slice(1)) }
  };
}

describe("PaneNavigationApi", () => {
  it("activates the destination pane and delivers after its view can render", () => {
    const { panes, navigation, flush } = setup();
    const handler = vi.fn();
    navigation.registerHandler("markdown-line", handler);

    navigation.jump(destination("L42"));
    expect(panes.getState().panes.context.activeTabId).toBe("details");
    expect(panes.getState().focusedPaneId).toBe("context");
    expect(handler).not.toHaveBeenCalled();

    flush();
    expect(handler).toHaveBeenCalledWith(destination("L42"));
  });

  it("retains a bounded, most-recent-first history and refreshes duplicate locations", () => {
    const { navigation } = setup(3);
    navigation.jump(destination("L10"));
    navigation.jump(destination("L20"));
    navigation.jump(destination("L30"));
    navigation.jump(destination("L10"));
    navigation.jump(destination("L40"));

    expect(navigation.getHistory().map((entry) => entry.key)).toEqual(["L40", "L10", "L30"]);
  });

  it("holds a jump until its destination handler mounts", () => {
    const { navigation, flush } = setup();
    const handler = vi.fn();
    navigation.jump(destination("L55"));
    flush();
    expect(handler).not.toHaveBeenCalled();

    navigation.registerHandler("markdown-line", handler);
    flush();
    expect(handler).toHaveBeenCalledWith(destination("L55"));
  });
});
