/**
 * The schematic. A live picture of one venue's installation, read top to
 * bottom: each stagebox above the passive panel cabled into it, then
 * AES50-A, then the destinations those stageboxes' outputs eventually feed,
 * then the console section (Mikserpult (FOH) + Console XLR outs, together),
 * then the X32's own 32 input channels, then its 16 output slots.
 *
 * The layout is hard-coded JSX on purpose (CLAUDE.md invariant 6): device ids
 * are the only thing it knows, and `installation.yaml` carries no coordinates.
 * Grouping each stagebox with the panel cabled to it, and grouping the two
 * console devices as one section, are layout decisions made here, not
 * something the components discover by walking the topology.
 *
 * This is a debugging/documentation view, not a mixer-control app: no menus,
 * no toolbars, no settings — a title, a connection state, and the venue. The
 * `SectionsControl` in the header is the one exception, kept as minimal
 * chrome as possible: a single trigger opening a popover, not five inline
 * toggles (see `SectionsControl`, `sectionVisibility.ts`).
 */

import { deviceId } from "@x32/domain";
import { useEffect, useState } from "react";

import { ConnectionStatus } from "./components/ConnectionStatus";
import { ConsoleSection } from "./components/ConsoleSection";
import { Destinations } from "./components/Destinations";
import { DiagnosticsControl } from "./components/DiagnosticsControl";
import { Mixer } from "./components/Mixer";
import { MixerOutputs } from "./components/MixerOutputs";
import { PhysicalInputPanel } from "./components/PhysicalInputPanel";
import { readSectionVisibility, writeSectionVisibility } from "./components/sectionVisibility";
import type { SectionVisibility } from "./components/sectionVisibility";
import { SectionsControl } from "./components/SectionsControl";
import { Stagebox } from "./components/Stagebox";
import { SystemStatus } from "./components/SystemStatus";
import { UpdateNotice } from "./components/UpdateNotice";
import type { GatewayMode, MixerGateway } from "./gateway/mixerGateway";

function initialVisibility(): SectionVisibility {
  if (typeof window === "undefined") {
    return { stage: true, destinations: true, console: true, channels: true, outputs: true };
  }
  return readSectionVisibility(window.localStorage);
}

export function App({ mode, gateway }: { mode: GatewayMode; gateway: MixerGateway }) {
  const [visibility, setVisibility] = useState<SectionVisibility>(initialVisibility);

  useEffect(() => {
    if (typeof window === "undefined") return;
    writeSectionVisibility(window.localStorage, visibility);
  }, [visibility]);

  const allHidden = Object.values(visibility).every((shown) => !shown);

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

      <main className="schematic">
        {allHidden && (
          <p className="schematic__empty">
            Every section is hidden — use Sections above to bring one back.
          </p>
        )}

        {visibility.stage && (
          <>
            <div className="stage">
              <section className="stage-area">
                <h2 className="stage-area__title">Stage left</h2>
                <Stagebox deviceId={deviceId("stagebox-1")} />
                <div className="cable" aria-hidden="true" />
                <PhysicalInputPanel deviceId={deviceId("front-left")} />
              </section>

              <section className="stage-area">
                <h2 className="stage-area__title">Stage right</h2>
                <Stagebox deviceId={deviceId("stagebox-2")} />
                <div className="cable" aria-hidden="true" />
                <PhysicalInputPanel deviceId={deviceId("front-right")} />
              </section>
            </div>

            <div className="bus" aria-hidden="true">
              <span className="bus__label">AES50-A</span>
            </div>
          </>
        )}

        {visibility.destinations && <Destinations />}

        {visibility.console && <ConsoleSection />}

        {visibility.channels && <Mixer />}

        {visibility.outputs && <MixerOutputs />}
      </main>
    </div>
  );
}
