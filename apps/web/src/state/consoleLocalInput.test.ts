/**
 * Console local-input sockets (issue #2) at the selector level (no DOM).
 *
 * The default mock snapshot already carries CH1–CH3 on `local` 1–3
 * (`packages/mixer-contracts/src/default-snapshot.ts`), so a console device
 * declared in the installation lights up immediately without any bespoke
 * fixture — this is the regression guard that it actually does.
 */

import type { EndpointId } from "@x32/domain";
import { deviceId, endpointId, localInput, mixerChannel, mixerChannelId } from "@x32/domain";
import { createDefaultMockSnapshot } from "@x32/mixer-contracts";
import { describe, expect, it } from "vitest";

import { venueInstallation } from "../__fixtures__/venue";

import { selectHoverStatus, selectSelectionStatus } from "./selectors";
import type { AppStore } from "./store";
import { createAppStore } from "./store";

/** The shared venue fixture plus a declared 32-input console device. */
function installationWithConsole() {
  const installation = venueInstallation();
  installation.devices.push({
    id: deviceId("console"),
    kind: "console",
    label: "Mikserpult (FOH)",
    inputs: 32,
  });
  return installation;
}

function storeWithConsole(): AppStore {
  const { channels } = createDefaultMockSnapshot();
  return createAppStore(installationWithConsole(), channels);
}

function hoverStatusOf(store: AppStore, endpoint: EndpointId) {
  return selectHoverStatus(endpoint)(store.getState());
}

function selectionStatusOf(store: AppStore, endpoint: EndpointId) {
  return selectSelectionStatus(endpoint)(store.getState());
}

const LOCAL_1 = endpointId(localInput("console", 1));
const LOCAL_2 = endpointId(localInput("console", 2));
const CH1 = mixerChannelId(1);
const CH2 = mixerChannelId(2);
const CH1_ENDPOINT = endpointId(mixerChannel(CH1));
const CH2_ENDPOINT = endpointId(mixerChannel(CH2));

describe("console local-input sockets", () => {
  it("marks CH1 hovered-on-route when hovering local:console:1", () => {
    const store = storeWithConsole();
    store.getState().setHoveredEndpoint(LOCAL_1);

    expect(hoverStatusOf(store, LOCAL_1)).toBe("hovered");
    expect(hoverStatusOf(store, CH1_ENDPOINT)).toBe("on-route");
  });

  it("marks local:console:2 on the selected route when CH2 is selected", () => {
    const store = storeWithConsole();
    store.getState().setSelectedChannel(CH2);

    expect(selectionStatusOf(store, CH2_ENDPOINT)).toBe("selected");
    expect(selectionStatusOf(store, LOCAL_2)).toBe("on-selected-route");
  });
});
