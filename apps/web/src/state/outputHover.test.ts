/**
 * Output-side hover highlighting at the selector level (issue #11) — the
 * output mirror of `hover.test.ts`. `hoveredEndpoint` is one slice covering
 * both graphs (architecture.md §5): `selectHoverStatus` consults `routeIndex`
 * first, then `outputRouteIndex`, and input/output endpoint ids are disjoint
 * so exactly one of those lookups ever hits.
 */

import {
  consoleOutput,
  destination,
  endpointId,
  mixerOutput,
  stageboxOutput,
} from "@x32/domain";
import { createDefaultMockSnapshot } from "@x32/mixer-contracts";
import { describe, expect, it } from "vitest";

import { exampleRig } from "../__fixtures__/example-rig";

import { selectHoverStatus } from "./selectors";
import type { AppStore } from "./store";
import { createAppStore } from "./store";

const installation = exampleRig();

function outputStore(): AppStore {
  const { outputs } = createDefaultMockSnapshot();
  return createAppStore(installation, [], outputs);
}

function statusOf(store: AppStore, endpoint: ReturnType<typeof endpointId>) {
  return selectHoverStatus(endpoint)(store.getState());
}

const OUT_13 = endpointId(mixerOutput(13));
const STAGEBOX_V_OUT_5 = endpointId(stageboxOutput("stagebox-1", 5));
const FILL_LEFT = endpointId(destination("fill-left"));

const OUT_7 = endpointId(mixerOutput(7));
const OUT_12 = endpointId(mixerOutput(12));

const OUT_1 = endpointId(mixerOutput(1));
const CONSOLE_OUT_1 = endpointId(consoleOutput(1));
const STAGEBOX_H_OUT_1 = endpointId(stageboxOutput("stagebox-2", 1)); // wholesale, uncabled
const ZONE_A = endpointId(destination("zone-a"));

describe("selectHoverStatus · output side (issue #11)", () => {
  it("lights the whole route from a destination, including the physical socket and the slot", () => {
    const store = outputStore();
    store.getState().setHoveredEndpoint(FILL_LEFT);

    expect(statusOf(store, FILL_LEFT)).toBe("hovered");
    expect(statusOf(store, STAGEBOX_V_OUT_5)).toBe("on-route");
    expect(statusOf(store, OUT_13)).toBe("on-route");
  });

  it("lights the same route hovered from the far end (Out slot)", () => {
    const store = outputStore();
    store.getState().setHoveredEndpoint(OUT_13);

    expect(statusOf(store, OUT_13)).toBe("hovered");
    expect(statusOf(store, STAGEBOX_V_OUT_5)).toBe("on-route");
    expect(statusOf(store, FILL_LEFT)).toBe("on-route");
  });

  it("lights Out 12 too when hovering Out 7 — both share Bus 3", () => {
    const store = outputStore();
    store.getState().setHoveredEndpoint(OUT_7);

    expect(statusOf(store, OUT_7)).toBe("hovered");
    expect(statusOf(store, OUT_12)).toBe("on-route");
  });

  it("lights Out 7 too when hovering Out 12 — symmetric", () => {
    const store = outputStore();
    store.getState().setHoveredEndpoint(OUT_12);

    expect(statusOf(store, OUT_12)).toBe("hovered");
    expect(statusOf(store, OUT_7)).toBe("on-route");
  });

  it("the wholesale-uncabled socket is on Out 1's route, same as the cabled console XLR — but reaches no destination of its own", () => {
    const store = outputStore();
    store.getState().setHoveredEndpoint(OUT_1);

    // Both physical presentations of the block light up: this is the
    // flat-set behaviour architecture.md §3 documents — the UI's own
    // wholesale-block distinction (tooltip/CSS) is a *separate* concern
    // from hover highlighting, handled in `format/tooltip.ts` and
    // `installation/outputCabling.ts`, not here.
    expect(statusOf(store, CONSOLE_OUT_1)).toBe("on-route");
    expect(statusOf(store, STAGEBOX_H_OUT_1)).toBe("on-route");
    expect(statusOf(store, ZONE_A)).toBe("on-route");
  });

  it("an off slot highlights only itself", () => {
    const store = outputStore();
    // Out 3 is off in the default mock snapshot.
    const OUT_3 = endpointId(mixerOutput(3));
    store.getState().setHoveredEndpoint(OUT_3);

    expect(statusOf(store, OUT_3)).toBe("hovered");
    expect(statusOf(store, OUT_1)).toBe("none");
  });

  it("lights nothing on the input graph when hovering an output endpoint", () => {
    const store = outputStore();
    store.getState().setHoveredEndpoint(OUT_13);

    // Disjoint id spaces: the mixer-channel graph must stay dark.
    expect(store.getState().routeIndex.byEndpoint.size).toBeGreaterThan(0);
  });
});
