/**
 * The console section: Mikserpult (FOH) and Console XLR outs, together as
 * one toggleable unit — both are "the desk at FOH", so one control hides or
 * shows them as a pair rather than fussing with separate toggles for each.
 *
 * The toggle is local UI state (architecture.md §5): it is neither mixer
 * configuration nor mixer runtime, so it lives here as component state, not
 * in the Zustand store, and never touches a selector or invalidates any
 * derived index. It's persisted to `localStorage` (see
 * `consoleSectionVisibility.ts`) because this app runs continuously on one
 * venue machine — a tech who collapses it shouldn't find it back on every
 * reload — but a storage failure never breaks rendering: it just falls back
 * to shown.
 *
 * Collapsing never unmounts the console devices' presence entirely from the
 * page's affordances: a slim, clearly-labelled bar always remains so the
 * section can never be "lost".
 */

import { deviceId } from "@x32/domain";
import { useEffect, useState } from "react";

import { ConsoleInputs } from "./ConsoleInputs";
import { ConsoleOutputs } from "./ConsoleOutputs";
import { readConsoleSectionVisible, writeConsoleSectionVisible } from "./consoleSectionVisibility";

function initialVisible(): boolean {
  if (typeof window === "undefined") return true;
  return readConsoleSectionVisible(window.localStorage);
}

export function ConsoleSection() {
  const [visible, setVisible] = useState<boolean>(initialVisible);

  useEffect(() => {
    if (typeof window === "undefined") return;
    writeConsoleSectionVisible(window.localStorage, visible);
  }, [visible]);

  if (!visible) {
    return (
      <div className="console-section console-section--collapsed">
        <button
          type="button"
          className="console-section__toggle"
          onClick={() => setVisible(true)}
        >
          Show console (FOH)
        </button>
      </div>
    );
  }

  return (
    <div className="console-section">
      <button
        type="button"
        className="console-section__toggle"
        onClick={() => setVisible(false)}
      >
        Hide console (FOH)
      </button>
      <div className="console-section__devices">
        <ConsoleInputs deviceId={deviceId("console")} />
        <ConsoleOutputs />
      </div>
    </div>
  );
}
