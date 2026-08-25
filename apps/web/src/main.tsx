/**
 * Bootstrap: load topology → create store → pick a gateway → render.
 *
 * Two kinds of failure, deliberately handled differently:
 *
 * - **Nothing to render** — the installation will not load, or no gateway can
 *   be built for the requested mode. Those replace the page with a startup
 *   error, each carrying its own hint.
 * - **The mixer is unreachable** — the schematic still stands. Topology and
 *   the last known configuration stay on screen with the connection reported
 *   as down (architecture.md §7); this is the behaviour the WebSocket gateway
 *   of plan step 9 inherits.
 *
 * The gateway is wired outside React deliberately: it owns its own lifecycle,
 * so StrictMode's double-invoked effects cannot connect it twice.
 */

import type { Installation } from "@x32/domain";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { StartupError } from "./components/StartupError";
import { DevControlSurface } from "./devtools/DevControlSurface";
import { createGateway } from "./gateway/createGateway";
import { LocalMockGateway } from "./gateway/localMockGateway";
import type { MixerGateway } from "./gateway/mixerGateway";
import { resolveGatewayMode } from "./gateway/mixerGateway";
import { resolveBridgeUrl } from "./gateway/webSocketMixerGateway";
import {
  INSTALLATION_ERROR_HINT,
  loadInstallation,
} from "./installation/loadInstallation";
import type { AppStore } from "./state/store";
import { createAppStore } from "./state/store";
import { StoreProvider } from "./state/storeContext";

import "./styles.css";

const container = document.getElementById("root");
if (container === null) {
  throw new Error('Missing mount point: no element with id "root"');
}

const root = createRoot(container);

function renderStartupFailure(error: unknown, hint?: string): void {
  root.render(
    <StrictMode>
      <StartupError error={error} hint={hint} />
    </StrictMode>,
  );
}

async function start(): Promise<void> {
  let installation: Installation;
  try {
    installation = await loadInstallation();
  } catch (error) {
    renderStartupFailure(error, INSTALLATION_ERROR_HINT);
    return;
  }

  const store = createAppStore(installation);
  const mode = resolveGatewayMode(window.location.search);
  const bridgeUrl = resolveBridgeUrl(window.location);

  let gateway: MixerGateway;
  try {
    gateway = createGateway(store, mode, bridgeUrl);
  } catch (error) {
    // Not a YAML problem: the message names the mode and says what to do.
    renderStartupFailure(error);
    return;
  }

  // Dev-only mock control surface (plan step 8): only reachable when the
  // resolved mode actually built a `LocalMockGateway` — never in live mode,
  // and never by inspecting `mode` alone, so this can't drift from what
  // `createGateway` actually constructed.
  const devMock = gateway instanceof LocalMockGateway ? gateway.mock : null;

  root.render(
    <StrictMode>
      <StoreProvider store={store}>
        <App mode={mode} gateway={gateway} />
        {devMock !== null && <DevControlSurface mock={devMock} />}
      </StoreProvider>
    </StrictMode>,
  );

  connect(gateway, store);
}

/**
 * A console that will not answer is a normal operating condition for a
 * debugging tool — show the venue, say the mixer is down, and let the gateway's
 * own events take over when it comes back.
 */
function connect(gateway: MixerGateway, store: AppStore): void {
  gateway.connect().catch((error: unknown) => {
    console.error("Mixer gateway failed to connect:", error);
    store.getState().setConnection("disconnected");
  });
}

void start();
