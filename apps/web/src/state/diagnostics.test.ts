/**
 * Diagnostic badges at the selector level (no DOM) — the baseline diff
 * (architecture.md §3 "Routing diff") mapped onto endpoint status, plan step
 * 14's third highlight layer.
 *
 * Three properties matter and are asserted below:
 *
 * 1. **Correct kind per channel** — a `source-mismatch` channel badges as
 *    such; every channel listed in an `unexpected-shared-source` badges as
 *    `shared-source`; a pure `name-mismatch` never badges at all.
 * 2. **Quiet by default** — no baseline, or a baseline that matches live
 *    state exactly, yields `"none"` everywhere.
 * 3. **Independence** — diagnostics is a separate slice from hover and
 *    selection: changing one never moves the others, and all three can be
 *    simultaneously non-`"none"` on the same endpoint.
 */

import type { EndpointId } from "@x32/domain";
import { endpointId, mixerChannel, mixerChannelId } from "@x32/domain";
import { createDefaultMockSnapshot } from "@x32/mixer-contracts";
import type { MixerSnapshot } from "@x32/mixer-contracts";
import { describe, expect, it } from "vitest";

import { venueInstallation } from "../__fixtures__/venue";

import {
  selectDiagnosticStatus,
  selectHoverStatus,
  selectSelectionStatus,
} from "./selectors";
import type { AppStore } from "./store";
import { createAppStore } from "./store";

const installation = venueInstallation();

// The mock's default snapshot's dual-consumer case (default-snapshot.ts):
// AES50-A 23 (stagebox-2 input 7) feeds both CH23 and CH28.
const CH1 = mixerChannelId(1);
const CH2 = mixerChannelId(2);
const CH23 = mixerChannelId(23);
const CH28 = mixerChannelId(28);
const CH1_ENDPOINT = endpointId(mixerChannel(CH1));
const CH2_ENDPOINT = endpointId(mixerChannel(CH2));
const CH23_ENDPOINT = endpointId(mixerChannel(CH23));
const CH28_ENDPOINT = endpointId(mixerChannel(CH28));

function diagnosticsStore(): AppStore {
  return createAppStore(installation, createDefaultMockSnapshot().channels);
}

function statusOf(store: AppStore, endpoint: EndpointId) {
  return selectDiagnosticStatus(endpoint)(store.getState());
}

/**
 * A baseline that disagrees with the default mock snapshot in exactly the
 * ways this file's tests need:
 *
 * - CH1's baseline source is `local 9`; live is `aes50A(1)` → source-mismatch.
 * - CH2's baseline *name* is "Old Name"; live is "Snare", source unchanged →
 *   name-mismatch only, no badge.
 * - CH23's baseline source is `local 9` too (so it no longer matches live's
 *   `aes50A(23)`, which is *also* a source-mismatch); CH28's baseline source
 *   stays `aes50A(23)`, matching live exactly. Live still has both CH23 and
 *   CH28 on `aes50A(23)` (the fixture's dual consumer) — the baseline no
 *   longer agrees they should share it (only CH28 stays on it there), so
 *   `compareRouting` flags `unexpected-shared-source` for [23, 28]: CH23
 *   badges `source-mismatch` (worse issue wins), CH28 — untouched by any
 *   per-channel diff — badges `shared-source` alone.
 */
function driftedBaseline(): MixerSnapshot {
  const { channels, selectedChannel } = createDefaultMockSnapshot();
  return {
    selectedChannel,
    channels: channels.map((channel) => {
      if (channel.channel === CH1) {
        return { ...channel, source: { kind: "local", input: 9 } };
      }
      if (channel.channel === CH2) {
        return { ...channel, name: "Old Name" };
      }
      if (channel.channel === CH23) {
        return { ...channel, source: { kind: "local", input: 9 } };
      }
      return channel;
    }),
  };
}

describe("selectDiagnosticStatus · no baseline / no drift", () => {
  it("is 'none' everywhere without a baseline", () => {
    const store = diagnosticsStore();

    expect(statusOf(store, CH1_ENDPOINT)).toBe("none");
    expect(statusOf(store, CH23_ENDPOINT)).toBe("none");
    expect(store.getState().discrepancies).toEqual([]);
  });

  it("is 'none' everywhere when the baseline matches live state exactly", () => {
    const store = diagnosticsStore();
    const matching = createDefaultMockSnapshot();

    store.getState().setBaseline(matching);

    expect(store.getState().discrepancies).toEqual([]);
    expect(statusOf(store, CH1_ENDPOINT)).toBe("none");
    expect(statusOf(store, CH23_ENDPOINT)).toBe("none");
    expect(statusOf(store, CH28_ENDPOINT)).toBe("none");
  });
});

describe("selectDiagnosticStatus · drifted baseline", () => {
  it("badges a channel whose live source disagrees with the baseline", () => {
    const store = diagnosticsStore();
    store.getState().setBaseline(driftedBaseline());

    expect(statusOf(store, CH1_ENDPOINT)).toBe("source-mismatch");
  });

  it("badges every channel listed in an unexpected-shared-source discrepancy", () => {
    const store = diagnosticsStore();
    store.getState().setBaseline(driftedBaseline());

    // CH23 also has its own source-mismatch (worse issue wins over shared).
    expect(statusOf(store, CH23_ENDPOINT)).toBe("source-mismatch");
    // CH28's own source matches the baseline — only the sharing is new.
    expect(statusOf(store, CH28_ENDPOINT)).toBe("shared-source");
  });

  it("never badges a pure name-mismatch", () => {
    const store = diagnosticsStore();
    store.getState().setBaseline(driftedBaseline());

    expect(
      store.getState().discrepancies.some((d) => d.kind === "name-mismatch" && d.channel === CH2),
    ).toBe(true);
    expect(statusOf(store, CH2_ENDPOINT)).toBe("none");
  });

  it("clears every badge when the baseline is reset to null", () => {
    const store = diagnosticsStore();
    store.getState().setBaseline(driftedBaseline());
    expect(statusOf(store, CH1_ENDPOINT)).toBe("source-mismatch");

    store.getState().setBaseline(null);

    expect(statusOf(store, CH1_ENDPOINT)).toBe("none");
    expect(statusOf(store, CH23_ENDPOINT)).toBe("none");
    expect(statusOf(store, CH28_ENDPOINT)).toBe("none");
  });
});

describe("diagnostics independence from hover and selection", () => {
  it("a hover change leaves every diagnostic status untouched", () => {
    const store = diagnosticsStore();
    store.getState().setBaseline(driftedBaseline());
    const before = {
      mismatch: statusOf(store, CH1_ENDPOINT),
      shared: statusOf(store, CH28_ENDPOINT),
    };

    store.getState().setHoveredEndpoint(CH2_ENDPOINT);

    expect(statusOf(store, CH1_ENDPOINT)).toBe(before.mismatch);
    expect(statusOf(store, CH28_ENDPOINT)).toBe(before.shared);
  });

  it("a selection change leaves every diagnostic status untouched", () => {
    const store = diagnosticsStore();
    store.getState().setBaseline(driftedBaseline());
    const before = {
      mismatch: statusOf(store, CH1_ENDPOINT),
      shared: statusOf(store, CH28_ENDPOINT),
    };

    store.getState().setSelectedChannel(CH28);

    expect(statusOf(store, CH1_ENDPOINT)).toBe(before.mismatch);
    expect(statusOf(store, CH28_ENDPOINT)).toBe(before.shared);
  });

  it("a diagnostics change leaves hover and selection status untouched", () => {
    const store = diagnosticsStore();
    store.getState().setHoveredEndpoint(CH1_ENDPOINT);
    store.getState().setSelectedChannel(CH1);
    const beforeHover = selectHoverStatus(CH1_ENDPOINT)(store.getState());
    const beforeSelection = selectSelectionStatus(CH1_ENDPOINT)(store.getState());

    store.getState().setBaseline(driftedBaseline());

    expect(selectHoverStatus(CH1_ENDPOINT)(store.getState())).toBe(beforeHover);
    expect(selectSelectionStatus(CH1_ENDPOINT)(store.getState())).toBe(beforeSelection);
  });

  it("all three layers can be non-none on the same endpoint at once", () => {
    const store = diagnosticsStore();
    store.getState().setBaseline(driftedBaseline());
    store.getState().setHoveredEndpoint(CH1_ENDPOINT);
    store.getState().setSelectedChannel(CH1);

    expect(selectHoverStatus(CH1_ENDPOINT)(store.getState())).toBe("hovered");
    expect(selectSelectionStatus(CH1_ENDPOINT)(store.getState())).toBe("selected");
    expect(statusOf(store, CH1_ENDPOINT)).toBe("source-mismatch");
  });
});
