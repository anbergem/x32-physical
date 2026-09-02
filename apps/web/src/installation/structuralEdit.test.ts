/**
 * The arithmetic behind structural editing (issue #29).
 *
 * These matter more than most tests in the app: `aes50.offset` and
 * `outputBlock.start` fail *silently and totally* when wrong — the schematic
 * stays plausible while pointing at the wrong socket, and nothing over OSC
 * can contradict it. Warning before the save is the only defence there is.
 */

import { deviceId } from "@x32/domain";
import { describe, expect, it } from "vitest";

import { exampleRig } from "../__fixtures__/example-rig";

import {
  aes50Collision,
  aes50RangeFor,
  aes50RangeOverruns,
  describeAes50Range,
  describeOutputBlock,
  describeRemoval,
  outputBlockOverruns,
  removalConsequences,
} from "./structuralEdit";

const STAGEBOX_1 = deviceId("stagebox-1");
const STAGEBOX_2 = deviceId("stagebox-2");
const FRONT_LEFT = deviceId("front-left");

describe("aes50RangeFor", () => {
  it("maps input n to channel offset + n, 1-based", () => {
    expect(aes50RangeFor(0, 16)).toEqual({ first: 1, last: 16 });
    expect(aes50RangeFor(16, 16)).toEqual({ first: 17, last: 32 });
  });

  it("returns null for values that describe no range", () => {
    expect(aes50RangeFor(-1, 16)).toBeNull();
    expect(aes50RangeFor(0, 0)).toBeNull();
    expect(aes50RangeFor(1.5, 16)).toBeNull();
  });
});

describe("describeAes50Range", () => {
  it("says the consequence of the number, in both vocabularies", () => {
    expect(describeAes50Range("A", 16, 16)).toBe("inputs 1–16 → AES50-A 17–32");
  });
});

describe("aes50RangeOverruns", () => {
  it("flags a range running past channel 48", () => {
    expect(aes50RangeOverruns(40, 16)).toBe(true);
    expect(aes50RangeOverruns(32, 16)).toBe(false);
  });
});

describe("aes50Collision", () => {
  it("finds the box whose channels would be claimed twice", () => {
    // The rig has stagebox-1 at A 1–16 and stagebox-2 at A 17–32.
    const collision = aes50Collision(exampleRig(), "A", 8, 16);

    expect(collision?.id).toBe(STAGEBOX_1);
  });

  it("returns null for a free range", () => {
    expect(aes50Collision(exampleRig(), "A", 32, 16)).toBeNull();
  });

  it("returns null on a different bus", () => {
    expect(aes50Collision(exampleRig(), "B", 0, 16)).toBeNull();
  });

  it("never reports a box colliding with itself", () => {
    // Editing stagebox-2's own offset must not flag stagebox-2.
    expect(aes50Collision(exampleRig(), "A", 16, 16, STAGEBOX_2)).toBeNull();
  });

  it("still flags the other box when editing one", () => {
    expect(aes50Collision(exampleRig(), "A", 0, 16, STAGEBOX_2)?.id).toBe(STAGEBOX_1);
  });
});

describe("describeOutputBlock", () => {
  it("names the console slots and where they land on the box", () => {
    expect(describeOutputBlock(9, 8)).toBe("presents Out 9–16 on its own outs 1–8");
  });

  it("flags a block running past Out 16", () => {
    expect(outputBlockOverruns(12, 8)).toBe(true);
    expect(outputBlockOverruns(9, 8)).toBe(false);
  });
});

describe("removalConsequences", () => {
  /** Counted from the fixture rather than hardcoded, so it cannot rot. */
  function cablesTouching(device: string): number {
    return exampleRig().connections.filter(
      (c) =>
        ("device" in c.from && c.from.device === device) ||
        ("device" in c.to && c.to.device === device),
    ).length;
  }

  it("counts every cable touching the device", () => {
    const result = removalConsequences(exampleRig(), STAGEBOX_1);

    expect(result.cables).toBe(cablesTouching(STAGEBOX_1));
    expect(result.cables).toBeGreaterThan(0);
  });

  it("counts the sockets that would be left reaching nothing", () => {
    // front-left 1–8 feed stagebox-1 1–8: removing the box strands all eight.
    expect(removalConsequences(exampleRig(), STAGEBOX_1).strandedSockets).toBe(8);
  });

  it("does not count a console output as a stranded socket", () => {
    // zone-a is fed by console output 1 — a numbered console out, not a
    // socket on another device, so nothing is left dangling on a panel.
    expect(removalConsequences(exampleRig(), deviceId("zone-a")).strandedSockets).toBe(0);
  });
});

describe("describeRemoval", () => {
  it("states the consequence in the installation's terms", () => {
    const sentence = describeRemoval(exampleRig(), STAGEBOX_1);

    expect(sentence).toMatch(/Remove Stagebox 1\?/);
    expect(sentence).toMatch(/cables will be removed/);
    expect(sentence).toMatch(/8 sockets will stop reaching the console/);
  });

  it("says so plainly when nothing is cabled", () => {
    // Every device in the fixture is cabled, which is itself worth knowing —
    // so add one that is not, rather than assert against a device that is.
    const rig = exampleRig();
    rig.devices.push({
      id: deviceId("spare-zone"),
      kind: "destination",
      label: "Spare Zone",
      inputs: 0,
    });

    expect(describeRemoval(rig, deviceId("spare-zone"))).toBe(
      "Remove Spare Zone? Nothing is cabled to it.",
    );
  });
});
