/**
 * `outputSlotsFor` (issue #11): a stagebox output's console Out slot is a
 * structural fact, independent of whether anything is cabled to it or
 * whether the slot is currently `off` — the wholesale-block case.
 */

import { consoleOutput, endpointId, stageboxOutput } from "@x32/domain";
import { describe, expect, it } from "vitest";

import { exampleRig } from "../__fixtures__/example-rig";

import { outputSlotsFor } from "./outputLabels";

describe("outputSlotsFor", () => {
  it("maps a stagebox output socket to its console Out slot via outputBlock.start", () => {
    const map = outputSlotsFor(exampleRig());
    // stagebox-1 presents OUT9-16 (outputBlock.start: 9): out 5 -> Out 13.
    expect(map.get(endpointId(stageboxOutput("stagebox-1", 5)))).toBe(13);
  });

  it("maps the uncabled wholesale socket too, same as a cabled one", () => {
    const map = outputSlotsFor(exampleRig());
    // stagebox-2 presents OUT1-8 (outputBlock.start: 1): out 1 -> Out 1,
    // even though nothing is cabled to this exact socket.
    expect(map.get(endpointId(stageboxOutput("stagebox-2", 1)))).toBe(1);
  });

  it("maps a console XLR out to its Out slot via the identity edge", () => {
    const map = outputSlotsFor(exampleRig());
    expect(map.get(endpointId(consoleOutput(1)))).toBe(1);
  });

  it("memoizes by installation object identity", () => {
    const installation = exampleRig();
    expect(outputSlotsFor(installation)).toBe(outputSlotsFor(installation));
  });
});
