import { describe, expect, it } from "vitest";

import { outputVenueInstallation } from "./__fixtures__/output-venue";
import { consoleOutput, destination, stageboxOutput } from "./endpoints";
import type { EndpointId } from "./ids";
import { MIXER_OUTPUT_COUNT } from "./ids";
import type { MixerOutputSourceRef, MixerOutputState } from "./output-mixer";
import type { OutputRoute, OutputRouteIndex } from "./output-routing";
import { buildOutputRouteIndex } from "./output-routing";

/** A bus source. */
function bus(n: number): MixerOutputSourceRef {
  return { kind: "bus", bus: n };
}

/** A full 16-slot state; slots not named are OFF. */
function outputs(
  sources: Record<number, MixerOutputSourceRef>,
): MixerOutputState[] {
  return Array.from({ length: MIXER_OUTPUT_COUNT }, (_unused, index) => {
    const output = index + 1;
    return {
      output,
      name: `Out ${output}`,
      source: sources[output] ?? { kind: "off" },
    };
  });
}

function id(value: string): EndpointId {
  return value as EndpointId;
}

function routeAt(index: OutputRouteIndex, endpoint: string): OutputRoute {
  const routes = index.byEndpoint.get(id(endpoint)) ?? [];
  expect(routes).toHaveLength(1);
  return routes[0] as OutputRoute;
}

function routeOf(index: OutputRouteIndex, output: number): OutputRoute {
  const route = index.byMixerOutput.get(output);
  expect(route).toBeDefined();
  return route as OutputRoute;
}

function serialize(index: OutputRouteIndex): string {
  return JSON.stringify({
    byMixerOutput: [...index.byMixerOutput.entries()],
    byEndpoint: [...index.byEndpoint.entries()],
  });
}

describe("buildOutputRouteIndex: the verified venue chain", () => {
  const index = buildOutputRouteIndex(
    outputVenueInstallation(),
    outputs({ 13: bus(1) }),
  );

  it("traces slot → stagebox out → destination, upstream first", () => {
    expect(routeOf(index, 13).endpoints).toEqual([
      "out:13",
      "stagebox-out:stagebox-v:5",
      "dest:front-venstre",
    ]);
  });

  it("reports the destination", () => {
    const route = routeOf(index, 13);
    expect(route.destinations).toEqual([destination("front-venstre")]);
    expect(route.mixerOutputs).toEqual([13]);
    expect(route.unroutedSource).toBeUndefined();
  });

  it("yields the identical route object from the mixer-output end and the destination end", () => {
    const fromSlot = routeOf(index, 13);
    expect(routeAt(index, "out:13")).toBe(fromSlot);
    expect(routeAt(index, "stagebox-out:stagebox-v:5")).toBe(fromSlot);
    expect(routeAt(index, "dest:front-venstre")).toBe(fromSlot);
  });
});

describe("buildOutputRouteIndex: one source, several outputs", () => {
  const index = buildOutputRouteIndex(
    outputVenueInstallation(),
    // Listed out of order on purpose: the route must not depend on it.
    outputs({ 12: bus(3), 7: bus(3) }),
  );

  it("builds one shared route with both slots, ascending", () => {
    const route = routeOf(index, 7);
    expect(route.mixerOutputs).toEqual([7, 12]);
    expect(routeOf(index, 12)).toBe(route);
  });

  it("orders the shared slots before their physical outs", () => {
    expect(routeOf(index, 7).endpoints).toEqual([
      "out:7",
      "out:12",
      "stagebox-out:stagebox-h:7",
      "stagebox-out:stagebox-v:4",
    ]);
  });
});

describe("buildOutputRouteIndex: a slot sourced off", () => {
  it("yields a route of just that slot, no destinations", () => {
    const index = buildOutputRouteIndex(
      outputVenueInstallation(),
      outputs({ 13: { kind: "off" } }),
    );
    const route = routeOf(index, 13);
    expect(route.endpoints).toEqual(["out:13"]);
    expect(route.destinations).toEqual([]);
    expect(route.unroutedSource).toEqual({ kind: "off" });
  });

  it("never merges two off slots into one route", () => {
    const index = buildOutputRouteIndex(outputVenueInstallation(), outputs({}));
    expect(routeOf(index, 3)).not.toBe(routeOf(index, 4));
  });
});

describe("buildOutputRouteIndex: a physical out with no destination cabled", () => {
  it("is present in byEndpoint, empty destinations, no throw", () => {
    const build = (): OutputRouteIndex =>
      buildOutputRouteIndex(
        outputVenueInstallation(),
        // Out 6 → Stagebox H out 6 (block presented wholesale); nothing is
        // cabled to a destination from it in this fixture.
        outputs({ 6: bus(5) }),
      );
    expect(build).not.toThrow();

    const route = routeOf(build(), 6);
    expect(route.endpoints).toEqual(["out:6", "stagebox-out:stagebox-h:6"]);
    expect(route.destinations).toEqual([]);
    expect(route.unroutedSource).toBeUndefined();

    expect(routeAt(build(), "stagebox-out:stagebox-h:6")).toEqual(route);
  });

  it("keeps a physical out downstream of an off slot hoverable", () => {
    const index = buildOutputRouteIndex(
      outputVenueInstallation(),
      outputs({}), // every slot off
    );
    // Stagebox H presents OUT1-8 wholesale regardless of source.
    const route = routeAt(index, "stagebox-out:stagebox-h:6");
    expect(route.mixerOutputs).toEqual([]);
    expect(route.destinations).toEqual([]);
  });
});

describe("buildOutputRouteIndex: declared console XLR out", () => {
  it("traces slot → console out → destination", () => {
    const index = buildOutputRouteIndex(
      outputVenueInstallation(),
      outputs({ 1: { kind: "matrix", matrix: 1 } }),
    );
    const route = routeOf(index, 1);
    // Out 1 is presented both on the console XLR (declared) and wholesale
    // on Stagebox H's block (derived) — both physical outs appear.
    expect(route.endpoints).toEqual([
      "out:1",
      "console-out:1",
      "stagebox-out:stagebox-h:1",
      "dest:sidesal",
    ]);
    expect(route.destinations).toEqual([destination("sidesal")]);
  });
});

describe("buildOutputRouteIndex: determinism", () => {
  const sources: Record<number, MixerOutputSourceRef> = {
    1: { kind: "matrix", matrix: 1 },
    6: bus(5),
    7: bus(3),
    8: bus(2),
    12: bus(3),
    13: bus(1),
  };

  it("produces identical output for identical input", () => {
    const first = buildOutputRouteIndex(outputVenueInstallation(), outputs(sources));
    const second = buildOutputRouteIndex(outputVenueInstallation(), outputs(sources));
    expect(serialize(second)).toBe(serialize(first));
  });

  it("does not depend on the order of slots, devices or connections", () => {
    const baseline = buildOutputRouteIndex(
      outputVenueInstallation(),
      outputs(sources),
    );

    const shuffled = outputVenueInstallation();
    shuffled.devices.reverse();
    shuffled.connections.reverse();
    const reordered = buildOutputRouteIndex(
      shuffled,
      [...outputs(sources)].reverse(),
    );

    expect(serialize(reordered)).toBe(serialize(baseline));
  });
});

describe("buildOutputRouteIndex: slots the caller did not describe", () => {
  it("still resolves every one of the 16 slots", () => {
    const index = buildOutputRouteIndex(outputVenueInstallation(), []);
    for (let output = 1; output <= MIXER_OUTPUT_COUNT; output += 1) {
      expect(index.byMixerOutput.has(output)).toBe(true);
    }
  });
});

describe("buildOutputRouteIndex: console-output helper", () => {
  it("is exported and constructs the expected ref", () => {
    expect(consoleOutput(1)).toEqual({ kind: "console-output", output: 1 });
    expect(stageboxOutput("stagebox-v", 5)).toEqual({
      kind: "stagebox-output",
      device: "stagebox-v",
      output: 5,
    });
  });
});
