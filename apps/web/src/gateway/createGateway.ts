/**
 * Mode selection (architecture.md §6). The single place that decides which
 * gateway the app runs; bootstrap asks for a mode and gets a `MixerGateway`.
 */

import { MockMixerClient } from "@x32/mixer-contracts";

import type { AppStore } from "../state/store";

import { LocalMockGateway } from "./localMockGateway";
import type { GatewayMode, MixerGateway } from "./mixerGateway";

export function createGateway(
  store: AppStore,
  mode: GatewayMode,
): MixerGateway {
  switch (mode) {
    case "mock":
      return new LocalMockGateway(store, new MockMixerClient());
    case "live":
      // Seam for plan step 9: `WebSocketMixerGateway` lands here, connects to
      // the bridge and feeds the same `applyToStore` mapping. Failing loudly
      // beats silently serving simulated data as if it were the console.
      throw new Error(
        "Live mode is not implemented yet: the WebSocket gateway arrives in " +
          "plan step 9. Start without ?mode=live to run against the mock.",
      );
  }
}
