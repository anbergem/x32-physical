/**
 * The gateway, reachable from anywhere in the schematic (issue #28).
 *
 * Cabling is completed by clicking a socket, and sockets are rendered several
 * layers down inside panels and stageboxes. Threading a gateway prop through
 * every one of those layers would put an editing concern into components that
 * otherwise know nothing about editing — so it travels by context instead,
 * the same way the store already does (`storeContext`).
 *
 * `null` when no provider is mounted, which is the honest default: components
 * check for it rather than assume an editor is present.
 */

import { createContext, useContext } from "react";
import type { ReactNode } from "react";

import type { MixerGateway } from "../gateway/mixerGateway";

const EditGatewayContext = createContext<MixerGateway | null>(null);

export function EditGatewayProvider({
  gateway,
  children,
}: {
  gateway: MixerGateway;
  children: ReactNode;
}) {
  return (
    <EditGatewayContext.Provider value={gateway}>{children}</EditGatewayContext.Provider>
  );
}

export function useEditGateway(): MixerGateway | null {
  return useContext(EditGatewayContext);
}
