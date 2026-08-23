/**
 * The schematic. A live picture of one venue's installation, read top to
 * bottom in signal direction: panels → stageboxes → AES50-A → the console.
 *
 * The layout is hard-coded JSX on purpose (CLAUDE.md invariant 6): device ids
 * are the only thing it knows, and `installation.yaml` carries no coordinates.
 * Grouping each stagebox with the panel cabled to it is a layout decision made
 * here, not something the components discover by walking the topology.
 *
 * This is a debugging/documentation view, not a mixer-control app: no menus,
 * no toolbars, no settings — a title, a connection state, and the venue.
 */

import { ConnectionStatus } from "./components/ConnectionStatus";
import { Mixer } from "./components/Mixer";
import { PhysicalInputPanel } from "./components/PhysicalInputPanel";
import { Stagebox } from "./components/Stagebox";
import type { GatewayMode } from "./gateway/mixerGateway";

export function App({ mode }: { mode: GatewayMode }) {
  return (
    <div className="app">
      <header className="app__bar">
        <h1 className="app__title">X32 Physical Routing Visualizer</h1>
        <ConnectionStatus mockData={mode === "mock"} />
      </header>

      <main className="schematic">
        <div className="stage">
          <section className="stage-area">
            <h2 className="stage-area__title">Stage left</h2>
            <PhysicalInputPanel deviceId="front-left" />
            <div className="cable" aria-hidden="true" />
            <Stagebox deviceId="stagebox-1" />
          </section>

          <section className="stage-area">
            <h2 className="stage-area__title">Stage right</h2>
            <PhysicalInputPanel deviceId="front-right" />
            <div className="cable" aria-hidden="true" />
            <Stagebox deviceId="stagebox-2" />
          </section>
        </div>

        <div className="bus" aria-hidden="true">
          <span className="bus__label">AES50-A</span>
        </div>

        <Mixer />
      </main>
    </div>
  );
}
