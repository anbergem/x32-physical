/**
 * `physicalOutputDestinationsFor` (issue #11) — the wholesale-block
 * distinction. The fixture mirrors the real venue: `stagebox-2` presents
 * `OUT1-8` wholesale, but only the console XLR (`console-out:1`) is cabled
 * to Zone A — `stagebox-out:stagebox-2:1` carries the block and nothing
 * else.
 */

import { consoleOutput, destination, endpointId, stageboxOutput } from "@x32/domain";
import { describe, expect, it } from "vitest";

import { exampleRig } from "../__fixtures__/example-rig";

import { physicalOutputDestinationsFor } from "./outputCabling";

describe("physicalOutputDestinationsFor", () => {
  it("maps a cabled console XLR out to its destination", () => {
    const map = physicalOutputDestinationsFor(exampleRig());
    expect(map.get(endpointId(consoleOutput(1)))).toEqual(destination("zone-a"));
  });

  it("maps a cabled stagebox XLR out to its destination", () => {
    const map = physicalOutputDestinationsFor(exampleRig());
    expect(map.get(endpointId(stageboxOutput("stagebox-1", 5)))).toEqual(
      destination("fill-left"),
    );
  });

  it("omits a physical out that carries a block wholesale but is not cabled", () => {
    const map = physicalOutputDestinationsFor(exampleRig());
    expect(map.has(endpointId(stageboxOutput("stagebox-2", 1)))).toBe(false);
  });

  it("memoizes by installation object identity", () => {
    const installation = exampleRig();
    expect(physicalOutputDestinationsFor(installation)).toBe(
      physicalOutputDestinationsFor(installation),
    );
  });
});
