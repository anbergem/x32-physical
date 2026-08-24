/**
 * Mode selection (architecture.md §6). The single place that decides which
 * gateway the app runs; bootstrap asks for a mode and gets a `MixerGateway`.
 */

import { MockMixerClient } from "@x32/mixer-contracts";

import type { AppStore } from "../state/store";

import { LocalMockGateway } from "./localMockGateway";
import type { GatewayMode, MixerGateway } from "./mixerGateway";
import { DEFAULT_BRIDGE_URL, WebSocketMixerGateway } from "./webSocketMixerGateway";

/**
 * @param bridgeUrl the bridge's WebSocket URL for live mode (ignored in mock
 *   mode). Resolving it from `window.location`/Vite env is the caller's job
 *   (`main.tsx`, via `resolveBridgeUrl`) — this function stays `window`-free
 *   so it is constructible in plain Node tests, like `resolveGatewayMode`.
 */
export function createGateway(
  store: AppStore,
  mode: GatewayMode,
  bridgeUrl: string = DEFAULT_BRIDGE_URL,
): MixerGateway {
  switch (mode) {
    case "mock":
      return new LocalMockGateway(store, new MockMixerClient());
    // `LocalMockGateway`'s own default `BaselineStore` (localStorage) is used
    // when none is passed — see `localMockGateway.ts`.
    case "live":
      return new WebSocketMixerGateway(store, bridgeUrl);
  }
}
