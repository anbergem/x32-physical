/**
 * The schematic. A live picture of one venue's installation, read top to
 * bottom: each stagebox above the passive panel cabled into it, then
 * AES50-A, then the destinations those stageboxes' outputs eventually feed,
 * then the console section (Mikserpult (FOH) + Console XLR outs, together —
 * collapsible via `ConsoleSection`), then the X32's own 32 input channels,
 * then its 16 output slots.
 *
 * The layout is hard-coded JSX on purpose (CLAUDE.md invariant 6): device ids
 * are the only thing it knows, and `installation.yaml` carries no coordinates.
 * Grouping each stagebox with the panel cabled to it, and grouping the two
 * console devices as one section, are layout decisions made here, not
 * something the components discover by walking the topology.
 *
 * This is a debugging/documentation view, not a mixer-control app: no menus,
 * no toolbars, no settings — a title, a connection state, and the venue. The
 * console section's show/hide toggle is the one exception, and it's kept as
 * minimal chrome deliberately (see `ConsoleSection`).
 */

import { deviceId } from "@x32/domain";

import { ConnectionStatus } from "./components/ConnectionStatus";
import { ConsoleSection } from "./components/ConsoleSection";
import { Destinations } from "./components/Destinations";
import { DiagnosticsControl } from "./components/DiagnosticsControl";
import { Mixer } from "./components/Mixer";
import { MixerOutputs } from "./components/MixerOutputs";
import { PhysicalInputPanel } from "./components/PhysicalInputPanel";
import { Stagebox } from "./components/Stagebox";
import { SystemStatus } from "./components/SystemStatus";
import { UpdateNotice } from "./components/UpdateNotice";
import type { GatewayMode, MixerGateway } from "./gateway/mixerGateway";

export function App({ mode, gateway }: { mode: GatewayMode; gateway: MixerGateway }) {
  return (
    <div className="app">
      <header className="app__bar">
        <h1 className="app__title">X32 Physical Routing Visualizer</h1>
        <div className="app__bar-status">
          <UpdateNotice />
          <DiagnosticsControl gateway={gateway} />
          <SystemStatus />
          <ConnectionStatus mockData={mode === "mock"} />
        </div>
      </header>

      <main className="schematic">
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

        <Destinations />

        <ConsoleSection />

        <Mixer />

        <MixerOutputs />
      </main>
    </div>
  );
}
