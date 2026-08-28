/**
 * AES50 status selectors (issue #17), at the selector level (no DOM). The
 * venue fixture (`../__fixtures__/example-rig.ts`) declares stageboxes on AES50-A
 * only, matching the real venue — AES50-B is unused, so an error there must
 * never surface.
 */

import type { Aes50LinkState } from "@x32/domain";
import { describe, expect, it } from "vitest";

import { exampleRig } from "../__fixtures__/example-rig";

import {
  selectAes50ChainWarning,
  selectAes50LinkWarningBus,
} from "./selectors";
import { createAppStore } from "./store";

function healthyLinkState(): Aes50LinkState {
  return {
    buses: [
      { bus: "A", audioError: false, auxError: false },
      { bus: "B", audioError: false, auxError: false },
    ],
    locked: true,
  };
}

describe("selectAes50LinkWarningBus", () => {
  it("returns null when there is no data yet", () => {
    const store = createAppStore(exampleRig(), []);
    expect(selectAes50LinkWarningBus(store.getState())).toBeNull();
  });

  it("returns null for a healthy link", () => {
    const store = createAppStore(exampleRig(), []);
    store.getState().setAes50LinkState(healthyLinkState());
    expect(selectAes50LinkWarningBus(store.getState())).toBeNull();
  });

  it("returns the bus for an audio error on a bus with declared stageboxes", () => {
    const store = createAppStore(exampleRig(), []);
    store.getState().setAes50LinkState({
      buses: [
        { bus: "A", audioError: true, auxError: false },
        { bus: "B", audioError: false, auxError: false },
      ],
      locked: true,
    });
    expect(selectAes50LinkWarningBus(store.getState())).toBe("A");
  });

  it("returns null for the same audio error on a bus the installation declares no stageboxes on", () => {
    const store = createAppStore(exampleRig(), []); // fixture: AES50-A only
    store.getState().setAes50LinkState({
      buses: [
        { bus: "A", audioError: false, auxError: false },
        { bus: "B", audioError: true, auxError: false },
      ],
      locked: true,
    });
    expect(selectAes50LinkWarningBus(store.getState())).toBeNull();
  });
});

describe("selectAes50ChainWarning", () => {
  it("is false with no chain data", () => {
    const store = createAppStore(exampleRig(), []);
    expect(selectAes50ChainWarning(store.getState())).toBe(false);
  });

  it("is false when the detected chain matches installation.yaml", () => {
    const store = createAppStore(exampleRig(), []);
    store.getState().setAes50Chain({
      bus: "A",
      boxes: [
        { position: 1, model: "S16", rawLetter: "A" },
        { position: 2, model: "S16", rawLetter: "A" },
      ],
    });
    expect(selectAes50ChainWarning(store.getState())).toBe(false);
  });

  it("surfaces when the detected chain disagrees with installation.yaml", () => {
    const store = createAppStore(exampleRig(), []);
    store.getState().setAes50Chain({
      bus: "A",
      boxes: [{ position: 1, model: "S16", rawLetter: "A" }], // 1 detected, 2 declared
    });
    expect(selectAes50ChainWarning(store.getState())).toBe(true);
  });
});

describe("healthy state (both selectors quiet, routeIndex preserved)", () => {
  it("preserves routeIndex object identity across aes50 updates", () => {
    const store = createAppStore(exampleRig(), []);
    const before = store.getState().routeIndex;

    store.getState().setAes50LinkState(healthyLinkState());
    store.getState().setAes50Chain({
      bus: "A",
      boxes: [
        { position: 1, model: "S16", rawLetter: "A" },
        { position: 2, model: "S16", rawLetter: "A" },
      ],
    });

    expect(store.getState().routeIndex).toBe(before);
    expect(selectAes50LinkWarningBus(store.getState())).toBeNull();
    expect(selectAes50ChainWarning(store.getState())).toBe(false);
  });
});
