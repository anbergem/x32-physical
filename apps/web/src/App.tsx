/**
 * The schematic. A live picture of the installation, read top to bottom: the
 * stage areas (each stagebox above the panel cabled into it), then the AES50
 * bus, then the destinations those outputs eventually feed, then the console
 * at FOH (its local inputs + Console XLR outs, side by side), then the X32's
 * own 32 input channels, then its 16 output slots.
 *
 * The *order of the sections* is hard-coded JSX on purpose (CLAUDE.md
 * invariant 6): it follows the signal path, and `installation.yaml` carries
 * no coordinates. What each section contains is not hard-coded — since issue
 * #22 no device id appears anywhere in this app. `Stage`, `Destinations` and
 * `ConsoleSection` derive their devices and their grouping from the
 * installation (`installation/deviceGroups.ts`), so a different venue's file
 * draws that venue, with no code change and no fallback to ours.
 *
 * Visibility is a separate axis from layout: the two console devices share a
 * row but are two independently toggleable *sections*, because one is an
 * input surface and the other an output surface (`sectionVisibility.ts`).
 *
 * This is a debugging/documentation view, not a mixer-control app: no menus,
 * no toolbars, no settings — a title, a connection state, and the venue. The
 * `SectionsControl` in the header is the one exception, kept as minimal
 * chrome as possible: a single trigger opening a popover, not a row of
 * inline toggles (see `SectionsControl`, `sectionVisibility.ts`).
 */

import { useEffect, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { ConnectionStatus } from "./components/ConnectionStatus";
import { ConsoleSection } from "./components/ConsoleSection";
import { Destinations } from "./components/Destinations";
import { DiagnosticsControl } from "./components/DiagnosticsControl";
import { Mixer } from "./components/Mixer";
import { MixerOutputs } from "./components/MixerOutputs";
import {
  allSectionsVisible,
  readSectionVisibility,
  writeSectionVisibility,
} from "./components/sectionVisibility";
import type { SectionVisibility } from "./components/sectionVisibility";
import { SectionsControl } from "./components/SectionsControl";
import { Stage } from "./components/Stage";
import { SystemStatus } from "./components/SystemStatus";
import { UpdateNotice } from "./components/UpdateNotice";
import type { GatewayMode, MixerGateway } from "./gateway/mixerGateway";
import { selectClearHover } from "./state/selectors";
import { useAppStore } from "./state/storeContext";

function initialVisibility(): SectionVisibility {
  if (typeof window === "undefined") return allSectionsVisible();
  return readSectionVisibility(window.localStorage);
}

export function App({ mode, gateway }: { mode: GatewayMode; gateway: MixerGateway }) {
  const [visibility, setVisibility] = useState<SectionVisibility>(initialVisibility);
  const clearHover = useAppStore(selectClearHover);

  useEffect(() => {
    if (typeof window === "undefined") return;
    writeSectionVisibility(window.localStorage, visibility);
  }, [visibility]);

  // Escape drops a pinned route — the keyboard equivalent of tapping the
  // background, and the habit anyone already has for dismissing something.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") clearHover();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [clearHover]);

  const allHidden = Object.values(visibility).every((shown) => !shown);
  const showConsole = visibility.consoleInputs || visibility.consoleOutputs;

  /**
   * Tapping anywhere that is not an endpoint clears a pinned route. The
   * endpoints' own handlers run first and this one checks whether the event
   * came from inside one, so a tap that pins is never immediately undone by
   * the same tap bubbling up here.
   */
  function handleBackgroundPointerUp(event: ReactPointerEvent<HTMLElement>): void {
    const target = event.target;
    if (target instanceof Element && target.closest("[data-endpoint]") !== null) return;
    clearHover();
  }

  return (
    <div className="app">
      <header className="app__bar">
        <h1 className="app__title">X32 Physical Routing Visualizer</h1>
        <div className="app__bar-status">
          <UpdateNotice />
          <DiagnosticsControl gateway={gateway} />
          <SystemStatus />
          <ConnectionStatus mockData={mode === "mock"} />
          <SectionsControl visibility={visibility} onChange={setVisibility} />
        </div>
      </header>

      <main className="schematic" onPointerUp={handleBackgroundPointerUp}>
        {allHidden && (
          <p className="schematic__empty">
            Every section is hidden — use Sections above to bring one back.
          </p>
        )}

        {visibility.stage && <Stage />}

        {visibility.destinations && <Destinations />}

        {showConsole && (
          <ConsoleSection
            showInputs={visibility.consoleInputs}
            showOutputs={visibility.consoleOutputs}
          />
        )}

        {visibility.channels && <Mixer />}

        {visibility.outputs && <MixerOutputs />}
      </main>
    </div>
  );
}
