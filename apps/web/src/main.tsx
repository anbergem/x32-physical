/**
 * Bootstrap: load topology → create store → pick a gateway → render.
 *
 * Everything that can fail happens before the first render, and any failure
 * renders as a full-page error instead of a blank screen. The gateway is wired
 * outside React deliberately: it owns its own lifecycle, so StrictMode's
 * double-invoked effects cannot connect it twice.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { StartupError } from "./components/StartupError";
import { createGateway } from "./gateway/createGateway";
import { resolveGatewayMode } from "./gateway/mixerGateway";
import { loadInstallation } from "./installation/loadInstallation";
import { createAppStore } from "./state/store";
import { StoreProvider } from "./state/storeContext";

import "./styles.css";

const container = document.getElementById("root");
if (container === null) {
  throw new Error('Missing mount point: no element with id "root"');
}

const root = createRoot(container);

function renderStartupFailure(error: unknown): void {
  root.render(
    <StrictMode>
      <StartupError error={error} />
    </StrictMode>,
  );
}

try {
  const installation = loadInstallation();
  const store = createAppStore(installation);
  const mode = resolveGatewayMode(window.location.search);
  const gateway = createGateway(store, mode);

  root.render(
    <StrictMode>
      <StoreProvider store={store}>
        <App mode={mode} />
      </StoreProvider>
    </StrictMode>,
  );

  // Only the startup handshake can reject here: a mixer that drops out later
  // arrives as a `connection-state-changed` event, not as a rejected promise.
  gateway.connect().catch(renderStartupFailure);
} catch (error) {
  renderStartupFailure(error);
}
